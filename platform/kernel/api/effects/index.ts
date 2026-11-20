/**
 * Workflow effects (architecture.md §7–8, code-structure.md §5): the code a service configuration names
 * (`competency.issueLicence`), run by the workflow engine inside the transition's transaction as `itrms_app`. A module
 * implements one as an injectable class marked `@Effect('<module>.<name>')`; the registry finds them among the providers
 * at startup, and the engine resolves effects only through it (task 0.19a).
 *
 * The keys a slice implements come from the same marks (`effectKeys`), so the manifest loader compares what a manifest
 * declares with what the code registers, never with a hand-written list.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { effectContractSchema, type EffectContract } from '@itrms/schemas';

import type { DbContext, Tx } from '../db';

/** `<module>.<name>`, as manifests declare effects (module-sdk's QUALIFIED). */
export const EFFECT_KEY = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9_.-]*$/;

/** What an effect is given: the transition's transaction and context, the case, its facts and the reference's argument. */
export interface EffectRun<Input = unknown> {
    tx: Tx;
    ctx: DbContext;
    caseId: string;
    /** the case's region and handling unit: where an effect files what it makes (not the actor's unit) */
    regionId: string;
    handlingUnitId: string;
    /** the case's number, and the configuration its service froze when it started (task 0.22b: how its fee is paid) */
    caseNumber: number;
    config: Readonly<Record<string, unknown>>;
    /** what follows the key in the reference: `licence-card` of `documents.issue:licence-card` */
    argument?: string;
    /**
     * With an input contract (task 0.21d): the request form's values by contract path, checked against it (every
     * required one there). Without one: the step's answers, as the transition was given them.
     */
    input: Input;
    facts: Readonly<Record<string, unknown>>;
    /** the comment the transition was taken with (a flag's or a return's reason), when it was given one */
    comment?: string;
}

/** What an effect hands back: facts the case keeps (a payment order's id) for later guards and effects. */
export interface EffectResult {
    facts?: Record<string, unknown>;
}

export interface WorkflowEffect<Input = unknown> {
    run(run: EffectRun<Input>): Promise<EffectResult | void>;
}

type EffectClass = abstract new (...args: never[]) => WorkflowEffect;

const MARKS = new WeakMap<object, string>();
const CONTRACTS = new WeakMap<object, EffectContract>();
const GIVES = new WeakSet<object>();
const ARGUMENTS = new WeakMap<object, EffectArgument>();
const REQUIRES = new WeakMap<object, readonly string[]>();

/** The arguments an effect takes after its key (`documents.issue:application-copy`), and whether it needs one. */
export interface EffectArgument {
    values: readonly string[];
    required?: boolean;
}

/** `<module>.<name>` or `<module>.<name>:<argument>`: a reference another effect requires before it. */
const REFERENCE = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9_.-]*(:[a-z0-9][a-z0-9-]*)?$/;

export interface EffectOptions {
    /**
     * What the effect reads from the service's request form (form-platform.md §3; task 0.21d): by field key, the kind of
     * value and whether it must be there. Publishing a service version or a form version fails while the form does not
     * meet it; the builder locks the fields.
     */
    input?: EffectContract;
    /**
     * Running it gives the service (a licence made active, a card or certificate issued): in a service with a fee, every
     * transition that runs it must guard on `payment.settled` (ADR-0042), or publishing the service version is refused.
     */
    givesService?: boolean;
    /**
     * The arguments it takes (task 1.4b2): publishing a service version that names it with another, or without one it
     * requires, is refused. An effect that declares none takes none.
     */
    argument?: EffectArgument;
    /**
     * The references a transition must name earlier in its effects, in the same transaction (task 1.4b2): the encumbrance
     * check before a transfer. Publishing a version that does not is refused.
     */
    requiresBefore?: readonly string[];
}

/** Marks an injectable class as the effect `key`, with its input contract. */
export function Effect(key: string, options: EffectOptions = {}) {
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- EFFECT_KEY is anchored; its first run cannot match the '.' before the second (linear time), and the key is a decorator's literal, not user input
    if (!EFFECT_KEY.test(key)) throw new Error(`@Effect('${key}'): an effect key is <module>.<name>`);
    const contract = options.input === undefined ? undefined : effectContractSchema.safeParse(options.input);
    if (contract && !contract.success)
        throw new Error(`@Effect('${key}'): its input contract is not valid: ${contract.error.message}`);
    for (const ref of options.requiresBefore ?? [])
        // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- REFERENCE is anchored and linear, and the reference is a decorator's literal
        if (!REFERENCE.test(ref)) throw new Error(`@Effect('${key}'): "${ref}" is not an effect reference`);
    if (options.argument && options.argument.values.length === 0)
        throw new Error(`@Effect('${key}'): an argument names the values it takes`);
    return (target: EffectClass): void => {
        MARKS.set(target, key);
        if (contract?.success) CONTRACTS.set(target, contract.data);
        if (options.givesService) GIVES.add(target);
        if (options.argument) ARGUMENTS.set(target, options.argument);
        if (options.requiresBefore?.length) REQUIRES.set(target, [...options.requiresBefore]);
    };
}

/** The key a class is marked with, if any. */
export const effectKeyOf = (target: object): string | undefined => MARKS.get(target);

/** The keys of a slice's effect classes, for its `InstalledSlice.effects` (each must be marked). */
export function effectKeys(classes: readonly EffectClass[]): string[] {
    return classes.map((c) => {
        const key = MARKS.get(c);
        if (!key) throw new Error(`${c.name} is listed as an effect but has no @Effect mark`);
        return key;
    });
}

/** The effects the installed modules registered, by key. */
@Injectable()
export class EffectRegistry implements OnModuleInit {
    private readonly effects = new Map<string, WorkflowEffect>();
    private readonly contracts = new Map<string, EffectContract>();
    private readonly giving = new Set<string>();
    private readonly arguments = new Map<string, EffectArgument>();
    private readonly requires = new Map<string, readonly string[]>();

    constructor(private readonly discovery: DiscoveryService) {}

    onModuleInit(): void {
        for (const wrapper of this.discovery.getProviders()) {
            const metatype = wrapper.metatype;
            const instance: unknown = wrapper.instance;
            const key = metatype ? MARKS.get(metatype) : undefined;
            if (!key || !instance || !metatype) continue;
            // a request-scoped or transient provider's static instance is an unconstructed prototype: effects are singletons
            if (wrapper.isTransient || !wrapper.isDependencyTreeStatic())
                throw new Error(`The effect ${key} must be a singleton (not request-scoped or transient)`);
            if (this.effects.has(key)) throw new Error(`The effect ${key} is registered twice`);
            this.effects.set(key, instance as WorkflowEffect);
            const contract = CONTRACTS.get(metatype);
            if (contract) this.contracts.set(key, contract);
            if (GIVES.has(metatype)) this.giving.add(key);
            const argument = ARGUMENTS.get(metatype);
            if (argument) this.arguments.set(key, argument);
            const requires = REQUIRES.get(metatype);
            if (requires) this.requires.set(key, requires);
        }
        // what an effect requires before it is itself an effect that is installed, with an argument it takes
        for (const [key, refs] of this.requires)
            for (const ref of refs) {
                const [needed, argument] = ref.split(':');
                if (!needed || !this.effects.has(needed))
                    throw new Error(`The effect ${key} requires ${ref}, which no installed module provides`);
                const takes = this.arguments.get(needed);
                if (argument !== undefined ? !takes?.values.includes(argument) : takes?.required === true)
                    throw new Error(`The effect ${key} requires ${ref}, an argument ${needed} does not take`);
            }
    }

    /** Every registered key: what a workflow definition may name. */
    keys(): ReadonlySet<string> {
        return new Set(this.effects.keys());
    }

    get(key: string): WorkflowEffect | undefined {
        return this.effects.get(key);
    }

    /** Whether running the effect gives the service (`givesService`): a fee-bearing service guards it on payment. */
    givesService(key: string): boolean {
        return this.giving.has(key);
    }

    /** The arguments the effect takes, if any. */
    argumentOf(key: string): EffectArgument | undefined {
        return this.arguments.get(key);
    }

    /** The references a transition must name before the effect. */
    requiresBefore(key: string): readonly string[] {
        return this.requires.get(key) ?? [];
    }

    /** The effect's input contract, if it declares one. */
    contract(key: string): EffectContract | undefined {
        return this.contracts.get(key);
    }
}
