/**
 * The one resolver (architecture.md §7, ADR-0026): a key's value is the nearest one along a chain of layers, from the
 * declared default to the person's own. The chain follows the unit's real ancestors (whatever the levels are called,
 * however deep), then its unit type, then the unit itself; a layer whose level the key does not allow is passed over,
 * and so is a stored value its schema no longer accepts (the code changed since it was set). Pure functions: the
 * settings registry and the service configuration (task 0.21b) build their chains and ask the same questions.
 */
import type { SettingLevel } from '@itrms/module-sdk';

export type SourceLevel = 'default' | SettingLevel | 'user';

/** Where a value comes from: the level, and the unit or unit type that set it. */
export interface Source {
    level: SourceLevel;
    unitId?: string;
    unitTypeId?: string;
}

export interface Layer {
    source: Source;
    values: ReadonlyMap<string, unknown>;
}

export interface Resolved {
    value: unknown;
    source: Source;
}

export interface ResolveRules {
    /** whether a value of `key` may be set at `level` (`overridableAt`, or a service version's policy) */
    allowed: (key: string, level: SourceLevel) => boolean;
    /** whether a stored value still fits the key's schema */
    accepts?: (key: string, value: unknown) => boolean;
}

/** The key's value from the nearest layer that sets it and may, or undefined when no layer does (not even a default). */
export function resolve(key: string, chain: readonly Layer[], rules: ResolveRules): Resolved | undefined {
    for (let i = chain.length - 1; i >= 0; i--) {
        const layer = chain[i];
        if (!layer?.values.has(key) || !rules.allowed(key, layer.source.level)) continue;
        const value = layer.values.get(key);
        if (rules.accepts && !rules.accepts(key, value)) continue;
        return { value, source: layer.source };
    }
    return undefined;
}

/** Every key's value along the chain. */
export function resolveAll(
    keys: Iterable<string>,
    chain: readonly Layer[],
    rules: ResolveRules
): Map<string, Resolved> {
    const out = new Map<string, Resolved>();
    for (const key of keys) {
        const found = resolve(key, chain, rules);
        if (found) out.set(key, found);
    }
    return out;
}

/** A unit on the way from the region's root down to the unit asked about, with its own values. */
export interface ChainUnit {
    unitId: string;
    values: ReadonlyMap<string, unknown>;
}

export interface ChainInput {
    defaults: ReadonlyMap<string, unknown>;
    installation?: ReadonlyMap<string, unknown>;
    /** the root first, the unit itself last (its ltree path, in order) */
    units: readonly ChainUnit[];
    /** the unit's type and the region's values for it */
    unitType?: { unitTypeId: string; values: ReadonlyMap<string, unknown> };
    /** the person's own values (preferences) */
    user?: ReadonlyMap<string, unknown>;
}

const EMPTY: ReadonlyMap<string, unknown> = new Map();

/**
 * The chain for a unit, farthest first: the defaults, the installation, the region's root, the units below it down to
 * the unit's parent, the unit's type, the unit itself, the person. A unit's own value beats its type's, and its type's
 * beats every unit above it (the region chose it for that kind of office).
 */
export function unitChain(input: ChainInput): Layer[] {
    const chain: Layer[] = [{ source: { level: 'default' }, values: input.defaults }];
    chain.push({ source: { level: 'installation' }, values: input.installation ?? EMPTY });
    const levelOf = (index: number): SettingLevel => (index === 0 ? 'region' : 'unit');
    const above = input.units.slice(0, -1);
    const self = input.units.at(-1);
    above.forEach((u, i) => chain.push({ source: { level: levelOf(i), unitId: u.unitId }, values: u.values }));
    if (input.unitType)
        chain.push({
            source: { level: 'unitType', unitTypeId: input.unitType.unitTypeId },
            values: input.unitType.values
        });
    if (self)
        chain.push({ source: { level: levelOf(input.units.length - 1), unitId: self.unitId }, values: self.values });
    if (input.user) chain.push({ source: { level: 'user' }, values: input.user });
    return chain;
}

/** Whether two sources name the same place. */
export const sameSource = (a: Source, b: Source): boolean =>
    a.level === b.level && a.unitId === b.unitId && a.unitTypeId === b.unitTypeId;

/** The chain without one layer: what a value would be if that place reset it (the "inherited" value of the screen). */
export const without = (chain: readonly Layer[], source: Source): Layer[] =>
    chain.filter((l) => !sameSource(l.source, source));
