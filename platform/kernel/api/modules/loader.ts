/**
 * The module manifest loader (ADR-0027, modularization.md §4): at startup every installed slice's manifest is checked
 * against the others, and the NestJS modules of the enabled ones are registered. A problem stops the start, with a message
 * that names the module and what is wrong:
 * - dependencies are installed, enabled, below the module in the layer order, and without cycles;
 * - each permission resource belongs to one module, and every role grants permissions that exist (installed);
 * - each event has one emitter, with a payload schema, and every consumed event is emitted by an installed module;
 * - the core (kernel, platform services, registries) cannot be switched off;
 * - every declared effect is implemented (and nothing undeclared is);
 * - every setting is declared once, with a value schema its default fits, and a name in Amharic and English;
 * - every manifest passes its own checks (@itrms/module-sdk).
 */
import {
    manifestProblems,
    permissionsOf,
    type InstalledSlice,
    type MessageCatalogues,
    type ModuleLayer,
    type ModuleManifest
} from '@itrms/module-sdk';

import { roleLabelKey } from '../iam/menu';
import { buildSettingsRegistry, settingLabelKey, settingProblems, type SettingsRegistry } from '../settings/registry';

const RANK: Record<ModuleLayer, number> = { kernel: 0, platform: 1, registry: 2, 'work-process': 3 };

export class ManifestError extends Error {
    constructor(readonly problems: string[]) {
        super(`The installed modules cannot start:\n${problems.map((p) => `- ${p}`).join('\n')}`);
        this.name = 'ManifestError';
    }
}

export interface LoadedSlices<Module> {
    /** The enabled modules' manifests, in installation order. */
    manifests: ModuleManifest[];
    /** Their NestJS modules, for the application module to import. */
    modules: Module[];
    /** Their message catalogues merged, by language tag. */
    messages: Record<string, Record<string, string>>;
    /** The settings they declare, with their schemas (ADR-0026). */
    settings: SettingsRegistry;
}

function cycles(manifests: ModuleManifest[]): string[] {
    const byKey = new Map(manifests.map((m) => [m.key, m]));
    const state = new Map<string, 'visiting' | 'done'>();
    const found: string[] = [];
    const visit = (key: string, path: string[]) => {
        if (state.get(key) === 'done') return;
        if (state.get(key) === 'visiting') {
            found.push(`dependency cycle: ${[...path.slice(path.indexOf(key)), key].join(' → ')}`);
            return;
        }
        state.set(key, 'visiting');
        for (const dep of byKey.get(key)?.dependsOn ?? []) if (byKey.has(dep)) visit(dep, [...path, key]);
        state.set(key, 'done');
    };
    for (const m of manifests) visit(m.key, []);
    return found;
}

/** Checks the installation and returns the enabled modules; throws a ManifestError listing every problem. */
export function loadSlices<Module>(
    slices: readonly InstalledSlice<Module>[],
    options: { disabled?: readonly string[] } = {}
): LoadedSlices<Module> {
    const problems: string[] = [];
    const disabled = new Set(options.disabled ?? []);
    const installed = new Map<string, InstalledSlice<Module>>();
    for (const slice of slices) {
        // each manifest on its own again (one built without defineModule would not have been checked)
        problems.push(...manifestProblems(slice.manifest).map((p) => `${slice.manifest.key}: ${p}`));
        if (installed.has(slice.manifest.key)) problems.push(`${slice.manifest.key}: is installed twice`);
        installed.set(slice.manifest.key, slice);
    }
    if (!installed.has('kernel')) problems.push('kernel: is not installed');
    for (const key of disabled) {
        const layer = installed.get(key)?.manifest.layer;
        if (!layer) problems.push(`${key}: is disabled but not installed`);
        // itrms.core (modularization.md §6): the kernel, the platform services and the registries are always on
        else if (layer !== 'work-process')
            problems.push(`${key}: is part of the core (${layer}) and cannot be disabled`);
    }

    const all = [...installed.values()].map((s) => s.manifest);
    const enabled = [...installed.values()].filter((s) => !disabled.has(s.manifest.key));
    const manifests = enabled.map((s) => s.manifest);

    for (const m of manifests) {
        for (const dep of m.dependsOn) {
            const target = installed.get(dep)?.manifest;
            if (!target) problems.push(`${m.key}: depends on "${dep}", which is not installed`);
            else if (disabled.has(dep)) problems.push(`${m.key}: depends on "${dep}", which is disabled`);
            else if (m.layer === 'work-process' && target.layer === 'work-process')
                problems.push(`${m.key}: depends on "${dep}": work-process modules never depend on each other`);
            else if (RANK[target.layer] > RANK[m.layer])
                problems.push(`${m.key}: depends on "${dep}" (${target.layer}), a layer above its own (${m.layer})`);
        }
    }
    problems.push(...cycles(manifests));

    // Names are checked across everything installed, so switching a product off never breaks the others: a role may
    // grant a disabled module's permission (it grants nothing while that module is off), and an event a disabled module
    // emits is simply not delivered.
    const resourceOwner = new Map<string, string>();
    for (const m of all)
        for (const resource of Object.keys(m.permissions)) {
            const owner = resourceOwner.get(resource);
            if (owner) problems.push(`${m.key}: permission resource "${resource}" is already defined by "${owner}"`);
            else resourceOwner.set(resource, m.key);
        }
    const permissions = new Set(all.flatMap(permissionsOf));
    for (const m of manifests)
        for (const [role, grants] of Object.entries(m.roles))
            for (const permission of grants)
                if (!permissions.has(permission))
                    problems.push(`${m.key}: role "${role}" grants "${permission}", which no installed module defines`);

    // effects and events: one emitter per event, with its schema (code-structure.md §5.6)
    const emitter = new Map<string, string>();
    for (const m of all)
        for (const event of m.events.emits) {
            const other = emitter.get(event);
            if (other) problems.push(`${m.key}: emits "${event}", which "${other}" already emits`);
            else emitter.set(event, m.key);
        }
    // registry lookups: a key (what a form field's provider names) has one owner
    const lookupOwner = new Map<string, string>();
    for (const m of all)
        for (const lookup of m.lookups) {
            const other = lookupOwner.get(lookup);
            if (other) problems.push(`${m.key}: declares lookup "${lookup}", which "${other}" already declares`);
            else lookupOwner.set(lookup, m.key);
        }
    // settings: one declaration per key, each with its value schema and a default that fits it (ADR-0026)
    problems.push(...settingProblems([...installed.values()]));
    for (const { manifest: m, effects = [], events = {} } of enabled) {
        for (const effect of m.effects)
            if (!effects.includes(effect))
                problems.push(`${m.key}: effect "${effect}" is declared but not implemented`);
        for (const effect of effects)
            if (!m.effects.includes(effect))
                problems.push(`${m.key}: implements effect "${effect}" without declaring it`);
        for (const event of m.events.emits)
            if (!events[event]) problems.push(`${m.key}: emits "${event}" without a payload schema`);
        for (const event of m.events.consumes)
            if (!emitter.has(event)) problems.push(`${m.key}: consumes "${event}", which no installed module emits`);
    }

    // the texts the server shows, from the slices' own catalogues: menu labels, role names and the menu's group names,
    // each in Amharic and English; a slice's keys are its own (no slice overwrites another's text)
    const messages: Record<string, Record<string, string>> = {};
    const needs = (owner: ModuleManifest, catalogues: MessageCatalogues, key: string, what: string) => {
        for (const language of ['am', 'en'])
            if (!catalogues[language]?.[key])
                problems.push(`${owner.key}: ${what} "${key}" has no ${language} text in its messages`);
    };
    const kernelCatalogues = installed.get('kernel')?.messages ?? {};
    const kernelManifest = installed.get('kernel')?.manifest;
    for (const { manifest: m, messages: catalogues = {} } of enabled) {
        for (const [language, catalogue] of Object.entries(catalogues))
            for (const [k, text] of Object.entries(catalogue)) {
                if (!k.startsWith(`${m.key}.`)) problems.push(`${m.key}: message "${k}" must start with "${m.key}."`);
                else (messages[language] ??= {})[k] = text;
            }
        for (const item of m.menu) {
            for (const label of [item.label, ...item.quickActions.map((a) => a.label)])
                needs(m, catalogues, label, 'menu label');
            for (const requires of [item.requires, ...item.quickActions.map((a) => a.requires)])
                if (requires.permission && !permissions.has(requires.permission))
                    problems.push(
                        `${m.key}: menu item "${item.key}" needs "${requires.permission}", which no installed module defines`
                    );
            if (item.group !== 'work-process' && kernelManifest)
                needs(kernelManifest, kernelCatalogues, `kernel.nav.group.${item.group}`, 'menu group');
        }
        for (const role of Object.keys(m.roles)) needs(m, catalogues, roleLabelKey(role), `role ${role}'s name`);
        for (const s of m.settings) needs(m, catalogues, settingLabelKey(m.key, s.key), `setting ${s.key}'s name`);
    }

    if (problems.length) throw new ManifestError(problems);
    return {
        manifests,
        modules: enabled.flatMap((s) => (s.module === undefined ? [] : [s.module])),
        messages,
        settings: buildSettingsRegistry(enabled)
    };
}
