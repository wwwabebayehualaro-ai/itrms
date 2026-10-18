// The module manifest (modularization.md §4). Task 0.6 replaces this minimal shape with the full Zod schema
// (permissions, roles, services, effects, events, settings, menu, …) and the startup validation.

export const MODULE_LAYERS = ['kernel', 'platform', 'registry', 'work-process'] as const;
export type ModuleLayer = (typeof MODULE_LAYERS)[number];

export interface ModuleManifest {
    readonly key: string;
    readonly layer: ModuleLayer;
    readonly version: string;
    readonly dependsOn: readonly string[];
}

const KEY = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Problems in a manifest, empty when it is valid. */
export function manifestProblems(manifest: ModuleManifest): string[] {
    const problems: string[] = [];
    if (!KEY.test(manifest.key)) problems.push(`key "${manifest.key}" must be kebab-case`);
    if (!MODULE_LAYERS.includes(manifest.layer)) problems.push(`layer "${manifest.layer}" is unknown`);
    if (!SEMVER.test(manifest.version)) problems.push(`version "${manifest.version}" is not semver`);
    if (manifest.dependsOn.includes(manifest.key)) problems.push('a module cannot depend on itself');
    if (new Set(manifest.dependsOn).size !== manifest.dependsOn.length) problems.push('dependsOn has duplicates');
    if (manifest.layer === 'kernel' && manifest.dependsOn.length > 0) problems.push('the kernel depends on nothing');
    return problems;
}

/** Declares a module. Throws on an invalid manifest, so a broken slice fails at import, not in production. */
export function defineModule<const M extends ModuleManifest>(manifest: M): M {
    const problems = manifestProblems(manifest);
    if (problems.length > 0) throw new Error(`Invalid manifest for "${manifest.key}": ${problems.join('; ')}`);
    return manifest;
}
