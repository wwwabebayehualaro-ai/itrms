/**
 * The services' effects against the forms they read (form-platform.md §3; task 0.21d): a service version's request form
 * must meet the input contract of every effect its workflow names (through the version's input map), and so must a new
 * version of that form before it is published. The problems are said in the reader's language. As the forms slice's
 * publish guard, this also names what a form's publication touches (the services, their open cases, the bound effects)
 * and the fields the builder shows locked.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Tx } from '@itrms/kernel/db';
import { EffectRegistry } from '@itrms/kernel/effects';
import { checkContract, contractLocks } from '@itrms/form-engine/core';
import { formVersions, type FormPublishGuard, type GuardResult } from '@itrms/forms/api';
import type { CheckProblem, FormLock } from '@itrms/forms/contracts';
import { cases, workflowDefinitionVersions } from '@itrms/workflow/api';
import {
    effectKeyOf,
    workflowDefinitionSchema,
    type ContractProblem,
    type EffectContract,
    type InputMap
} from '@itrms/schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';

import am from '../messages/am.json';
import en from '../messages/en.json';
import { serviceDefinitions, serviceVersions } from './services.table';

const CATALOGUES: Record<string, Record<string, string>> = { am, en };

/** A message of the services' catalogue in a language (Amharic when the language has none). */
export function servicesText(key: string, language: string, values: Record<string, string> = {}): string {
    const template = CATALOGUES[language]?.[key] ?? (am as Record<string, string>)[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

/** A contract problem in the reader's language. */
export function contractMessage(effect: string, p: ContractProblem, language: string): string {
    const kind = (k: string | null | undefined) => (k ? servicesText(`services.contract.kind.${k}`, language) : '—');
    return servicesText(`services.contract.${p.code}`, language, {
        effect,
        key: p.key,
        expected: kind(p.expected),
        actual: kind(p.actual)
    });
}

/** The effects a workflow's transitions name. */
export function effectsOf(definition: unknown): string[] {
    const parsed = workflowDefinitionSchema.safeParse(definition);
    if (!parsed.success) return [];
    return [...new Set(parsed.data.transitions.flatMap((t) => (t.effects ?? []).map((e) => effectKeyOf(e))))];
}

export interface ContractFinding {
    effect: string;
    problem: ContractProblem;
}

/** What a request form lacks for the contracts of the effects (none without a contract). */
export function contractFindings(
    effects: readonly string[],
    contractOf: (effect: string) => EffectContract | undefined,
    document: unknown,
    inputMap: InputMap
): ContractFinding[] {
    return effects.flatMap((effect) => {
        const contract = contractOf(effect);
        return contract
            ? checkContract(contract, document, inputMap[effect]).map((problem) => ({ effect, problem }))
            : [];
    });
}

@Injectable()
export class ServiceFormGuard implements FormPublishGuard {
    constructor(@Inject(EffectRegistry) private readonly effects: EffectRegistry) {}

    /** The services whose version in use names a version of the form, with what their workflow's effects need. */
    private async readers(tx: Tx, formId: string) {
        const rows = await tx
            .select({
                code: serviceDefinitions.code,
                name: serviceDefinitions.name,
                regionId: serviceDefinitions.regionId,
                inputMap: serviceVersions.inputMap,
                definition: workflowDefinitionVersions.definition
            })
            .from(serviceDefinitions)
            .innerJoin(serviceVersions, eq(serviceVersions.id, serviceDefinitions.currentVersionId))
            .innerJoin(formVersions, eq(formVersions.id, serviceVersions.formVersionId))
            .innerJoin(workflowDefinitionVersions, eq(workflowDefinitionVersions.id, serviceVersions.workflowVersionId))
            .where(eq(formVersions.formId, formId));
        return rows.map((r) => ({
            ...r,
            reading: effectsOf(r.definition).filter((e) => this.effects.contract(e) !== undefined)
        }));
    }

    async check(tx: Tx, formId: string, document: unknown, language: string): Promise<GuardResult> {
        const problems: CheckProblem[] = [];
        const services = [];
        for (const r of await this.readers(tx, formId)) {
            if (!r.reading.length) continue;
            for (const { effect, problem } of contractFindings(
                r.reading,
                (e) => this.effects.contract(e),
                document,
                r.inputMap
            ))
                problems.push({
                    code: 'contract',
                    severity: 'error',
                    fieldId: problem.key,
                    path: `document.fields.${problem.key}`,
                    message: `${r.code}: ${contractMessage(effect, problem, language)}`
                });
            // its cases not yet closed, whatever version they started on (they keep it)
            const [open] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(cases)
                .where(
                    and(
                        eq(cases.regionId, r.regionId),
                        isNull(cases.closedAt),
                        sql`${cases.config} ->> 'serviceCode' = ${r.code}`
                    )
                );
            services.push({ code: r.code, name: r.name, openCases: open?.n ?? 0, effects: r.reading });
        }
        return { problems, services };
    }

    async locks(tx: Tx, formId: string): Promise<FormLock[]> {
        const byKey = new Map<string, FormLock>();
        for (const r of await this.readers(tx, formId))
            for (const effect of r.reading) {
                const contract = this.effects.contract(effect);
                if (!contract) continue;
                for (const lock of contractLocks(contract, r.inputMap[effect])) {
                    const known = byKey.get(lock.key);
                    if (known) {
                        known.required ||= lock.required;
                        if (!known.effects.includes(effect)) known.effects.push(effect);
                        if (!known.services.includes(r.code)) known.services.push(r.code);
                    } else
                        byKey.set(lock.key, {
                            key: lock.key,
                            kind: lock.kind,
                            required: lock.required,
                            effects: [effect],
                            services: [r.code]
                        });
                }
            }
        return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
    }
}
