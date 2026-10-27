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

import type { DbContext, Tx } from '../db';

/** `<module>.<name>`, as manifests declare effects (module-sdk's QUALIFIED). */
export const EFFECT_KEY = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9_.-]*$/;

/** What an effect is given: the transition's transaction and context, the case, its facts and the reference's argument. */
export interface EffectRun<Input = unknown> {
    tx: Tx;
    ctx: DbContext;
    caseId: string;
    /** what follows the key in the reference: `licence-card` of `documents.issue:licence-card` */
    argument?: string;
    /** the step's answers, typed by the effect's contract (0.21a) */
    input: Input;
    facts: Readonly<Record<string, unknown>>;
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

/** Marks an injectable class as the effect `key`. */
export function Effect(key: string) {
    if (!EFFECT_KEY.test(key)) throw new Error(`@Effect('${key}'): an effect key is <module>.<name>`);
    return (target: EffectClass): void => {
        MARKS.set(target, key);
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

    constructor(private readonly discovery: DiscoveryService) {}

    onModuleInit(): void {
        for (const wrapper of this.discovery.getProviders()) {
            const metatype = wrapper.metatype;
            const instance: unknown = wrapper.instance;
            const key = metatype ? MARKS.get(metatype) : undefined;
            if (!key || !instance) continue;
            // a request-scoped or transient provider's static instance is an unconstructed prototype: effects are singletons
            if (wrapper.isTransient || !wrapper.isDependencyTreeStatic())
                throw new Error(`The effect ${key} must be a singleton (not request-scoped or transient)`);
            if (this.effects.has(key)) throw new Error(`The effect ${key} is registered twice`);
            this.effects.set(key, instance as WorkflowEffect);
        }
    }

    /** Every registered key: what a workflow definition may name. */
    keys(): ReadonlySet<string> {
        return new Set(this.effects.keys());
    }

    get(key: string): WorkflowEffect | undefined {
        return this.effects.get(key);
    }
}
