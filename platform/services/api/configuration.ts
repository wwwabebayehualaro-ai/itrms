/**
 * A service's configuration for a unit (architecture.md §7; task 0.21b), as pure functions: the version's defaults, then
 * the override of each unit from the region's root down to the unit, through the kernel's one resolver; a unit's value
 * counts only for a family its version's policy allows at that level, and only while it fits the version (a state the
 * workflow has, a field the form has). The resolved values are frozen on a case when it starts.
 */
import {
    resolveAll,
    unitChain,
    type ChainUnit,
    type Layer,
    type Resolved,
    type Source,
    type SourceLevel
} from '@itrms/kernel/settings';
import type { WorkflowDefinition } from '@itrms/schemas';

import { configFamily, configValueSchemas, type OverrideConflict, type OverridePolicy } from '../contracts';

/** What a version's keys are checked against: its workflow's states and its form's field keys. */
export interface VersionFacts {
    /** the workflow's states a step's SLA may be set for (tasks and waits) */
    timedStates: ReadonlySet<string>;
    /** the request form's field keys */
    fieldKeys: ReadonlySet<string>;
}

export function factsOf(workflow: WorkflowDefinition, fieldKeys: Iterable<string>): VersionFacts {
    return {
        timedStates: new Set(workflow.states.filter((s) => s.kind === 'task' || s.kind === 'wait').map((s) => s.key)),
        fieldKeys: new Set(fieldKeys)
    };
}

/** Whether a unit at `level` may set `key` under `policy` (the version's own defaults always hold). */
export function allowedBy(policy: OverridePolicy, key: string, level: SourceLevel): boolean {
    if (level === 'default') return true;
    const family = configFamily(key);
    if (!family || (level !== 'region' && level !== 'unit')) return false;
    return policy[family]?.includes(level) ?? false;
}

/** What is wrong with a key's value for a version at a level, if anything. */
export function keyProblem(
    key: string,
    value: unknown,
    facts: VersionFacts,
    policy: OverridePolicy,
    level: 'default' | 'region' | 'unit'
): OverrideConflict['problem'] | undefined {
    const family = configFamily(key);
    if (!family || !configValueSchemas[family].safeParse(value).success) return 'invalid_value';
    if (!allowedBy(policy, key, level)) return 'not_allowed';
    const part = key.split('.')[1] ?? '';
    if (family === 'sla' && !facts.timedStates.has(part)) return 'unknown_state';
    if (family === 'help' && !facts.fieldKeys.has(part)) return 'unknown_field';
    return undefined;
}

export interface VersionConfig {
    defaults: Readonly<Record<string, unknown>>;
    policy: OverridePolicy;
    facts: VersionFacts;
}

/** The chain of a unit: the version's defaults, then the overrides from the region's root down to the unit. */
export function configChain(version: VersionConfig, units: readonly ChainUnit[]): Layer[] {
    return unitChain({ defaults: new Map(Object.entries(version.defaults)), units });
}

/** Every key's value for the unit at the end of `units` (root first), and where it comes from. */
export function resolveConfig(version: VersionConfig, units: readonly ChainUnit[]): Map<string, Resolved> {
    const chain = configChain(version, units);
    const keys = new Set(chain.flatMap((l) => [...l.values.keys()]));
    return resolveAll(keys, chain, {
        allowed: (key, level) => allowedBy(version.policy, key, level),
        // a value that no longer fits the version (its state or field is gone) is passed over
        accepts: (key, value) => keyProblem(key, value, version.facts, version.policy, 'default') === undefined
    });
}

/** The configuration a case freezes: the values grouped by family, and the versions it runs on. */
export interface FrozenConfig extends Record<string, unknown> {
    serviceCode: string;
    serviceVersionId: string;
    formVersionId: string | null;
    approval_unit?: unknown;
    sla: Record<string, unknown>;
    help: Record<string, unknown>;
    templateHeader?: unknown;
    /** where each value came from (the bureau's version, the region, a unit) */
    sources: Record<string, Source>;
}

export function frozenConfig(
    resolved: ReadonlyMap<string, Resolved>,
    ids: { serviceCode: string; serviceVersionId: string; formVersionId: string | null }
): FrozenConfig {
    const config: FrozenConfig = { ...ids, sla: {}, help: {}, sources: {} };
    for (const [key, { value, source }] of [...resolved].sort(([a], [b]) => a.localeCompare(b))) {
        const [family, part] = key.split('.');
        if (family === 'sla' && part) config.sla[part] = value;
        else if (family === 'help' && part) config.help[part] = value;
        else if (family === 'approval_unit') config.approval_unit = value;
        else if (family === 'templateHeader') config.templateHeader = value;
        config.sources[key] = source;
    }
    return config;
}
