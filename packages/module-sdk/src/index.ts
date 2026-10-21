/**
 * The module manifest (modularization.md §4): what a slice declares about itself, shared by the API and the web app. One
 * Zod schema checks each manifest on its own (`defineModule` throws at import); the API checks the installation as a whole
 * at startup (`@itrms/kernel/api`: dependencies, unique keys, effects, event schemas).
 */
import { i18nTextSchema } from '@itrms/schemas';
import { z } from 'zod';

export const MODULE_LAYERS = ['kernel', 'platform', 'registry', 'work-process'] as const;
export type ModuleLayer = (typeof MODULE_LAYERS)[number];

/** The licensable products (modularization.md §6). */
export const PRODUCTS = [
    'itrms.core',
    'itrms.licensing',
    'itrms.public-transport',
    'itrms.roads',
    'itrms.safety',
    'itrms.office'
] as const;

const KEY = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** `<module>.<name>`: roles (`hr.payroll_officer`), effects, settings, widgets, reports. */
const QUALIFIED = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9_.-]*$/;
/** A cross-cutting role of the kernel: a plain name (`cashier`, `bureau_admin`; roles-and-permissions.md §1). */
const PLAIN_ROLE = /^[a-z][a-z0-9_]*$/;
/** A unit-type capability (`prints_documents`; org-and-unit-types.md §3). */
export const CAPABILITY = /^[a-z][a-z0-9_]*$/;
/** `<entity>.<happened>.v<n>` (code-structure.md §5.6). */
const EVENT = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v[1-9]\d*$/;
/** A service code from the catalogue: DVC-01, PT-12. */
const SERVICE = /^[A-Z]{2,5}-\d{2}$/;
/** `resource:action` (`licence:issue`). */
export const PERMISSION = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

const key = z.string().regex(KEY, 'must be kebab-case');
const qualified = z.string().regex(QUALIFIED, 'must be <module>.<name>');
const event = z.string().regex(EVENT, 'must be <entity>.<happened>.v<n>');
const service = z.string().regex(SERVICE, 'must be a service code such as DVC-01');

export const manifestSchema = z
    .object({
        key,
        layer: z.enum(MODULE_LAYERS),
        version: z.string().regex(SEMVER, 'is not semver'),
        title: i18nTextSchema.optional(),
        /** The work process it serves (1–10), for work-process modules. */
        workProcess: z.number().int().min(1).max(10).optional(),
        dependsOn: z.array(key).default([]),
        entitlement: z.enum(PRODUCTS).optional(),
        /** resource → actions it defines: `{ licence: ['read', 'issue'] }` gives `licence:read`, `licence:issue`. */
        permissions: z.record(key, z.array(key).min(1)).default({}),
        /** role key → the permissions it grants (any installed module's). */
        roles: z
            .record(
                z
                    .string()
                    .refine((k) => QUALIFIED.test(k) || PLAIN_ROLE.test(k), 'must be <module>.<role> or a plain name'),
                z.array(z.string().regex(PERMISSION, 'must be resource:action'))
            )
            .default({}),
        services: z.array(service).default([]),
        effects: z.array(qualified).default([]),
        events: z
            .object({ emits: z.array(event).default([]), consumes: z.array(event).default([]) })
            .strict()
            .default({ emits: [], consumes: [] }),
        settings: z
            .array(
                z
                    .object({
                        key: qualified,
                        default: z.unknown(),
                        overridableAt: z.array(z.string()).default([])
                    })
                    .loose()
            )
            .default([]),
        numberSequences: z.array(z.object({ key, pattern: z.string().min(1) }).strict()).default([]),
        lookups: z.array(key).default([]),
        /** Menu entries (navigation-and-menus.md); their shape is checked by the shell. */
        menu: z.array(z.unknown()).default([]),
        widgets: z.array(qualified).default([]),
        reports: z.array(qualified).default([]),
        documents: z.array(key).default([]),
        capabilitiesRequired: z
            .record(service, z.array(z.string().regex(CAPABILITY, 'must be a snake_case capability')))
            .default({})
    })
    .strict();

export type ModuleManifestInput = z.input<typeof manifestSchema>;
export type ModuleManifest = z.output<typeof manifestSchema>;

const issueText = (issue: z.core.$ZodIssue) =>
    `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`;

/** Problems of one manifest on its own (shape, naming, ownership of its keys), empty when it is valid. */
export function manifestProblems(input: unknown): string[] {
    const parsed = manifestSchema.safeParse(input);
    if (!parsed.success) return parsed.error.issues.map(issueText);
    const m = parsed.data;
    const problems: string[] = [];
    if (m.dependsOn.includes(m.key)) problems.push('a module cannot depend on itself');
    if (new Set(m.dependsOn).size !== m.dependsOn.length) problems.push('dependsOn has duplicates');
    if (m.layer === 'kernel' && m.dependsOn.length > 0) problems.push('the kernel depends on nothing');
    if (m.layer === 'work-process' && m.workProcess === undefined)
        problems.push('a work-process module names its workProcess');
    if ((m.layer === 'work-process' || m.layer === 'registry') && !m.title)
        problems.push(`a ${m.layer} module has a title`);
    // a module names only its own roles, effects, settings, widgets and reports; the kernel also owns the cross-cutting
    // roles (plain names) and the installation-wide settings (i18n.*, security.*, ui.*, service.*)
    const own = (what: string, keys: string[]) =>
        keys
            .filter((k) => !k.startsWith(`${m.key}.`))
            .forEach((k) => problems.push(`${what} "${k}" must start with "${m.key}."`));
    if (m.layer !== 'kernel') {
        own('role', Object.keys(m.roles));
        own(
            'setting',
            m.settings.map((s) => s.key)
        );
    }
    own('effect', m.effects);
    own('widget', m.widgets);
    own('report', m.reports);
    for (const [name, list] of [
        ['effects', m.effects],
        ['services', m.services],
        ['events.emits', m.events.emits],
        ['events.consumes', m.events.consumes]
    ] as const)
        if (new Set(list).size !== list.length) problems.push(`${name} has duplicates`);
    return problems;
}

/** Declares a module. Throws on an invalid manifest, so a broken slice fails at import, not in production. */
export function defineModule(input: ModuleManifestInput): ModuleManifest {
    const problems = manifestProblems(input);
    if (problems.length > 0) throw new Error(`Invalid manifest for "${String(input.key)}": ${problems.join('; ')}`);
    return manifestSchema.parse(input);
}

/** The permission keys a manifest defines (`licence:issue`). */
export const permissionsOf = (m: ModuleManifest): string[] =>
    Object.entries(m.permissions).flatMap(([resource, actions]) => actions.map((a) => `${resource}:${a}`));

/**
 * A slice as the API installs it: its manifest, its NestJS module (the type is the API's business: `unknown` here, since
 * tool packages import no framework), the effects it implements and the payload schemas of the events it emits.
 */
export interface InstalledSlice<Module = unknown> {
    manifest: ModuleManifest;
    module?: Module;
    effects?: readonly string[];
    events?: Readonly<Record<string, z.ZodType>>;
}
