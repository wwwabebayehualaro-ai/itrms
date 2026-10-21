/**
 * The module manifest loader (ADR-0027, modularization.md §4): at startup every installed slice's manifest is checked
 * against the others, and the NestJS modules of the enabled ones are registered. A problem stops the start, with a message
 * that names the module and what is wrong:
 * - dependencies are installed, enabled, below the module in the layer order, and without cycles;
 * - each permission resource belongs to one module, and every role grants permissions that exist (installed);
 * - each event has one emitter, with a payload schema, and every consumed event is emitted by an installed module;
 * - the core (kernel, platform services, registries) cannot be switched off;
 * - every declared effect is implemented (and nothing undeclared is);
 * - every manifest passes its own checks (@itrms/module-sdk).
 */
import {
    manifestProblems,
    permissionsOf,
    type InstalledSlice,
    type ModuleLayer,
    type ModuleManifest
} from '@itrms/module-sdk';

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

    if (problems.length) throw new ManifestError(problems);
    return { manifests, modules: enabled.flatMap((s) => (s.module === undefined ? [] : [s.module])) };
}
