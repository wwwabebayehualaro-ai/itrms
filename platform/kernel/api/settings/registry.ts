/**
 * The settings registry (ADR-0026, org-and-unit-types.md §4): every setting the enabled slices declare, with its owner,
 * its value schema and the message key of its name. Built once at start-up by the manifest loader, which refuses a
 * setting without a schema, with a default its schema rejects, or without a name in Amharic and English.
 */
import type { InstalledSlice, SettingDeclaration } from '@itrms/module-sdk';
import type { z } from 'zod';

import type { ResolveRules, SourceLevel } from './resolve';

export interface SettingEntry {
    declaration: SettingDeclaration;
    /** the module that declares it */
    owner: string;
    schema: z.ZodType;
    /** the message key of its name (`kernel.setting.i18n.languages`, `forms.setting.exports.keepDays`) */
    label: string;
}

export type SettingsRegistry = ReadonlyMap<string, SettingEntry>;

/** The message key of a setting's name, in its owner's catalogue. */
export const settingLabelKey = (owner: string, key: string): string =>
    `${owner}.setting.${key.startsWith(`${owner}.`) ? key.slice(owner.length + 1) : key}`;

/** The problems of the slices' settings, for the loader: schemas, defaults, keys declared once. */
export function settingProblems(slices: readonly InstalledSlice[]): string[] {
    const problems: string[] = [];
    const owner = new Map<string, string>();
    for (const { manifest: m, settings: schemas = {} } of slices) {
        for (const s of m.settings) {
            const other = owner.get(s.key);
            if (other) problems.push(`${m.key}: declares setting "${s.key}", which "${other}" already declares`);
            else owner.set(s.key, m.key);
            const schema = schemas[s.key];
            if (!schema) problems.push(`${m.key}: setting "${s.key}" has no value schema`);
            else if (!schema.safeParse(s.default).success)
                problems.push(`${m.key}: setting "${s.key}": its default does not fit its schema`);
            // a person's own choice needs no second factor: a sensitive setting is never one (SEC-SE-5)
            if (s.userPreference && s.sensitive)
                problems.push(`${m.key}: setting "${s.key}" cannot be both a personal choice and sensitive`);
        }
        for (const key of Object.keys(schemas))
            if (!m.settings.some((s) => s.key === key))
                problems.push(`${m.key}: has a schema for setting "${key}" without declaring it`);
    }
    return problems;
}

export function buildSettingsRegistry(slices: readonly InstalledSlice[]): SettingsRegistry {
    const registry = new Map<string, SettingEntry>();
    for (const { manifest: m, settings: schemas = {} } of slices)
        for (const declaration of m.settings) {
            const schema = schemas[declaration.key];
            if (schema)
                registry.set(declaration.key, {
                    declaration,
                    owner: m.key,
                    schema,
                    label: settingLabelKey(m.key, declaration.key)
                });
        }
    return registry;
}

/** Whether a setting may hold a value of its own at a level: its declaration says so (the default always). */
export function allowedAt(entry: SettingEntry | undefined, level: SourceLevel): boolean {
    if (!entry) return false;
    if (level === 'default') return true;
    if (level === 'user') return entry.declaration.userPreference;
    return entry.declaration.overridableAt.includes(level);
}

/** The resolver's rules for the registry's settings. */
export const registryRules = (registry: SettingsRegistry): ResolveRules => ({
    allowed: (key, level) => allowedAt(registry.get(key), level),
    accepts: (key, value) => registry.get(key)?.schema.safeParse(value).success ?? false
});

/** The defaults of every setting, as the resolver's first layer. */
export const defaultsOf = (registry: SettingsRegistry): Map<string, unknown> =>
    new Map([...registry].map(([key, e]) => [key, e.declaration.default]));
