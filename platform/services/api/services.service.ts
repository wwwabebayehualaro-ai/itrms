/**
 * The service catalogue at work (architecture.md §6.2, §7; task 0.21b). A region's bureau publishes a version of a
 * service (its form and workflow versions, defaults and override policy), checked against what it names; a unit below
 * overrides the keys the policy lets it; a request starts a case at the person's unit on the configuration resolved for
 * it, frozen on the case. A new version re-checks every override below the region and reports what no longer fits; the
 * overrides stay (a value that does not fit is passed over), and open cases keep what they froze.
 */
import { Inject, Injectable } from '@nestjs/common';
import { contentHash, deleteAudited, insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { EffectRegistry } from '@itrms/kernel/effects';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { effectiveServices, withinScope, type OrgUnit } from '@itrms/kernel/org';
import { orgUnits } from '@itrms/kernel/tables';
import { publishedKeysOf } from '@itrms/form-engine/core';
import { formDefinitions, formVersions } from '@itrms/forms/api';
import { CasesService, workflowDefinitions, workflowDefinitionVersions, type CaseActor } from '@itrms/workflow/api';
import { effectKeyOf, workflowDefinitionSchema, type I18nText } from '@itrms/schemas';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';

import {
    configValuesSchema,
    overridePolicySchema,
    type CatalogueEntry,
    type OverrideConflict,
    type OverridePolicy,
    type ServiceVersionInput
} from '../contracts';
import {
    factsOf,
    frozenConfig,
    keyProblem,
    resolveConfig,
    type VersionConfig,
    type VersionFacts
} from './configuration';
import { serviceDefinitions, serviceOverrides, serviceVersions } from './services.table';

type Definition = typeof serviceDefinitions.$inferSelect;
type Version = typeof serviceVersions.$inferSelect;

/** Today in Addis Ababa, as a date (YYYY-MM-DD). */
export const addisToday = (now = new Date()): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(now);

const fieldErrors = (problems: { path: string; code: string; message: string }[]) =>
    new ValidationError('validation_failed', { errors: problems });

/** The seed's catalogue into a region: new codes added, names and modules kept current (idempotent by code). */
export async function importCatalogue(tx: Tx, regionId: string, entries: readonly CatalogueEntry[]): Promise<number> {
    const existing = new Map(
        (await tx.select().from(serviceDefinitions).where(eq(serviceDefinitions.regionId, regionId))).map((d) => [
            d.code,
            d
        ])
    );
    let changed = 0;
    for (const e of entries) {
        const found = existing.get(e.code);
        if (!found) {
            await insertAudited(tx, serviceDefinitions, {
                regionId,
                code: e.code,
                process: e.process,
                module: e.module,
                name: e.name
            });
            changed++;
        } else if (
            found.process !== e.process ||
            found.module !== e.module ||
            JSON.stringify(found.name) !== JSON.stringify(e.name)
        ) {
            await updateAudited(tx, serviceDefinitions, found.id, found.rowVersion, {
                process: e.process,
                module: e.module,
                name: e.name
            });
            changed++;
        }
    }
    return changed;
}

export interface ServiceSummary {
    code: string;
    name: I18nText;
    process: number;
    module: string;
    configured: boolean;
    /** offered by the unit the person acts for */
    enabled: boolean;
    currentVersion: number | null;
}

export interface VersionOut {
    id: string;
    number: number;
    formVersionId: string | null;
    workflowVersionId: string;
    defaults: Record<string, unknown>;
    overridePolicy: OverridePolicy;
    effectiveFrom: string;
    note: string | null;
    publishedAt: string;
}

export interface PublishOut {
    version: VersionOut;
    /** the overrides below the region the new version finds problems in (they stay; a value that does not fit is skipped) */
    conflicts: OverrideConflict[];
}

const versionOut = (v: Version): VersionOut => ({
    id: v.id,
    number: v.number,
    formVersionId: v.formVersionId,
    workflowVersionId: v.workflowVersionId,
    defaults: v.defaults,
    overridePolicy: overridePolicySchema.parse(v.overridePolicy),
    effectiveFrom: v.effectiveFrom,
    note: v.note,
    publishedAt: v.createdAt.toISOString()
});

@Injectable()
export class ServicesService {
    constructor(
        @Inject(EffectRegistry) private readonly effects: EffectRegistry,
        @Inject(CasesService) private readonly cases: CasesService
    ) {}

    /** A service of the person's region by code (404 when the catalogue has none). */
    async definition(tx: Tx, regionId: string, code: string): Promise<Definition> {
        const [found] = await tx
            .select()
            .from(serviceDefinitions)
            .where(and(eq(serviceDefinitions.regionId, regionId), eq(serviceDefinitions.code, code)));
        if (!found) throw new NotFoundError();
        return found;
    }

    /** Whether the region's catalogue has the code (the kernel's service enablement asks, through its port). */
    async exists(tx: Tx, regionId: string, code: string): Promise<boolean> {
        const [found] = await tx
            .select({ id: serviceDefinitions.id })
            .from(serviceDefinitions)
            .where(and(eq(serviceDefinitions.regionId, regionId), eq(serviceDefinitions.code, code)));
        return Boolean(found);
    }

    async list(tx: Tx, unitId: string, regionId: string): Promise<ServiceSummary[]> {
        const enabled = new Set(await effectiveServices(tx, unitId));
        const rows = await tx
            .select({ d: serviceDefinitions, number: serviceVersions.number })
            .from(serviceDefinitions)
            .leftJoin(serviceVersions, eq(serviceVersions.id, serviceDefinitions.currentVersionId))
            .where(eq(serviceDefinitions.regionId, regionId))
            .orderBy(asc(serviceDefinitions.process), asc(serviceDefinitions.code));
        return rows.map(({ d, number }) => ({
            code: d.code,
            name: d.name as I18nText,
            process: d.process,
            module: d.module,
            configured: d.currentVersionId !== null,
            enabled: enabled.has(d.code),
            currentVersion: number ?? null
        }));
    }

    async versions(tx: Tx, regionId: string, code: string): Promise<VersionOut[]> {
        const d = await this.definition(tx, regionId, code);
        const rows = await tx
            .select()
            .from(serviceVersions)
            .where(eq(serviceVersions.serviceId, d.id))
            .orderBy(desc(serviceVersions.number));
        return rows.map(versionOut);
    }

    /** What a version is checked against: its workflow (its states, its effects) and its form (its field keys). */
    private async facts(
        tx: Tx,
        input: { workflowVersionId: string; formVersionId: string | null }
    ): Promise<VersionFacts & { effects: string[] }> {
        const problems: { path: string; code: string; message: string }[] = [];
        const [workflow] = await tx
            .select({ definition: workflowDefinitionVersions.definition, active: workflowDefinitions.active })
            .from(workflowDefinitionVersions)
            .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowDefinitionVersions.definitionId))
            .where(eq(workflowDefinitionVersions.id, input.workflowVersionId));
        const parsed = workflow && workflowDefinitionSchema.safeParse(workflow.definition);
        if (!workflow || !parsed?.success)
            problems.push({
                path: 'workflowVersionId',
                code: 'unknown_workflow',
                message: 'No such workflow version.'
            });
        else if (!workflow.active)
            problems.push({
                path: 'workflowVersionId',
                code: 'workflow_off',
                message: 'The workflow is switched off.'
            });
        let fieldKeys: string[] = [];
        if (input.formVersionId) {
            const [form] = await tx
                .select({ document: formVersions.document, active: formDefinitions.active })
                .from(formVersions)
                .innerJoin(formDefinitions, eq(formDefinitions.id, formVersions.formId))
                .where(eq(formVersions.id, input.formVersionId));
            if (!form) problems.push({ path: 'formVersionId', code: 'unknown_form', message: 'No such form version.' });
            else if (!form.active)
                problems.push({ path: 'formVersionId', code: 'form_off', message: 'The form is switched off.' });
            else fieldKeys = [...publishedKeysOf(form.document).keys()];
        }
        if (problems.length || !parsed?.success) throw fieldErrors(problems);
        const definition = parsed.data;
        const effects = [
            ...new Set(definition.transitions.flatMap((t) => (t.effects ?? []).map((e) => effectKeyOf(e))))
        ];
        const registered = this.effects.keys();
        for (const effect of effects)
            if (!registered.has(effect))
                problems.push({
                    path: 'workflowVersionId',
                    code: 'unknown_effect',
                    message: `The workflow names the effect "${effect}", which no installed module provides.`
                });
        if (problems.length) throw fieldErrors(problems);
        return { ...factsOf(definition, fieldKeys), effects };
    }

    /** The region's root, if the person's seat is there (a bureau's decision); else 403. */
    private async atRoot(tx: Tx, ctx: DbContext): Promise<OrgUnit> {
        const [root] = await tx
            .select()
            .from(orgUnits)
            .where(eq(orgUnits.id, ctx.regionId ?? ''));
        if (!root) throw new NotFoundError();
        if (root.path !== ctx.scopePath)
            throw new ForbiddenError({ audit: { reason: 'service_version_below_region', unit: ctx.unitId ?? '' } });
        return root;
    }

    /**
     * Publishes a version (a seat at the region's root): the form and workflow versions must exist and be on, the
     * workflow's effects registered, the defaults fit them. Every override below is checked against it; the problems are
     * reported, nothing is changed below.
     */
    async publish(tx: Tx, ctx: DbContext, code: string, input: ServiceVersionInput): Promise<PublishOut> {
        await this.atRoot(tx, ctx);
        const d = await this.definition(tx, ctx.regionId ?? '', code);
        const facts = await this.facts(tx, input);
        const problems = Object.entries(input.defaults).flatMap(([key, value]) => {
            const problem = keyProblem(key, value, facts, input.overridePolicy, 'default');
            return problem
                ? [{ path: `defaults.${key}`, code: problem, message: `"${key}" does not fit this version.` }]
                : [];
        });
        if (problems.length) throw fieldErrors(problems);
        const effectiveFrom = input.effectiveFrom ?? addisToday();
        const content = {
            formVersionId: input.formVersionId,
            workflowVersionId: input.workflowVersionId,
            defaults: input.defaults,
            overridePolicy: input.overridePolicy,
            effectiveFrom
        };
        // versions are numbered in order: the definition row is the lock
        await tx.select().from(serviceDefinitions).where(eq(serviceDefinitions.id, d.id)).for('update');
        const [last] = await tx
            .select({ n: sql<number>`coalesce(max(${serviceVersions.number}), 0)::int` })
            .from(serviceVersions)
            .where(eq(serviceVersions.serviceId, d.id));
        const version = await insertAudited(tx, serviceVersions, {
            regionId: d.regionId,
            serviceId: d.id,
            number: (last?.n ?? 0) + 1,
            contentHash: contentHash(content),
            formVersionId: input.formVersionId,
            workflowVersionId: input.workflowVersionId,
            defaults: input.defaults,
            overridePolicy: input.overridePolicy,
            effectiveFrom,
            note: input.note ?? null
        });
        const [fresh] = await tx.select().from(serviceDefinitions).where(eq(serviceDefinitions.id, d.id));
        if (fresh)
            await updateAudited(tx, serviceDefinitions, d.id, fresh.rowVersion, { currentVersionId: version.id });
        return { version: versionOut(version), conflicts: await this.conflicts(tx, d.id, facts, input.overridePolicy) };
    }

    /** The overrides of a service below the region that do not fit a version. */
    private async conflicts(
        tx: Tx,
        serviceId: string,
        facts: VersionFacts,
        policy: OverridePolicy
    ): Promise<OverrideConflict[]> {
        const rows = await tx
            .select({ o: serviceOverrides, name: orgUnits.name, parentId: orgUnits.parentId })
            .from(serviceOverrides)
            .innerJoin(orgUnits, eq(orgUnits.id, serviceOverrides.unitId))
            .where(eq(serviceOverrides.serviceId, serviceId))
            .orderBy(asc(orgUnits.path));
        // by unit (top down), then key: jsonb keeps no order of its own
        return rows.flatMap(({ o, name, parentId }) =>
            sortedEntries(o.values).flatMap(([key, value]) => {
                const problem = keyProblem(key, value, facts, policy, parentId === null ? 'region' : 'unit');
                return problem ? [{ unitId: o.unitId, unitName: name, key, problem }] : [];
            })
        );
    }

    /** The version a new case of the service starts on today: the newest that has come into effect. */
    private async effectiveVersion(tx: Tx, serviceId: string): Promise<Version | undefined> {
        const [v] = await tx
            .select()
            .from(serviceVersions)
            .where(and(eq(serviceVersions.serviceId, serviceId), lte(serviceVersions.effectiveFrom, addisToday())))
            .orderBy(desc(serviceVersions.effectiveFrom), desc(serviceVersions.number))
            .limit(1);
        return v;
    }

    /** The unit and the units above it (root first), and their overrides of the service. */
    private async chainUnits(tx: Tx, unit: OrgUnit, serviceId: string) {
        const units = await tx
            .select()
            .from(orgUnits)
            .where(sql`${orgUnits.path} @> ${unit.path}::ltree`)
            .orderBy(sql`nlevel(${orgUnits.path})`);
        const overrides = await tx
            .select()
            .from(serviceOverrides)
            .where(
                and(
                    eq(serviceOverrides.serviceId, serviceId),
                    inArray(
                        serviceOverrides.unitId,
                        units.map((u) => u.id)
                    )
                )
            );
        return {
            units,
            overrides,
            chain: units.map((u) => ({
                unitId: u.id,
                values: new Map(Object.entries(overrides.find((o) => o.unitId === u.id)?.values ?? {}))
            }))
        };
    }

    private async versionConfig(tx: Tx, v: Version): Promise<VersionConfig> {
        const facts = await this.facts(tx, v);
        return { defaults: v.defaults, policy: overridePolicySchema.parse(v.overridePolicy), facts };
    }

    private async visibleUnit(tx: Tx, unitId: string): Promise<OrgUnit> {
        const [unit] = await tx.select().from(orgUnits).where(eq(orgUnits.id, unitId));
        if (!unit) throw new NotFoundError();
        return unit;
    }

    /** A service's configuration for a unit: each value and where it comes from, the unit's own override, its version. */
    async configuration(tx: Tx, ctx: DbContext, unitId: string, code: string) {
        const unit = await this.visibleUnit(tx, unitId);
        const d = await this.definition(tx, unit.regionId, code);
        const v = await this.effectiveVersion(tx, d.id);
        if (!v) throw new ConflictError('not_configured', { detail: `${code} is not configured yet.` });
        const version = await this.versionConfig(tx, v);
        const { chain, overrides } = await this.chainUnits(tx, unit, d.id);
        const own = overrides.find((o) => o.unitId === unit.id);
        const level = unit.parentId === null ? 'region' : 'unit';
        const resolved = resolveConfig(version, chain);
        return {
            serviceCode: code,
            version: versionOut(v),
            values: Object.fromEntries([...resolved].map(([key, r]) => [key, r])),
            own: own ? { values: own.values, reason: own.reason, version: own.rowVersion } : null,
            /** the problems of the unit's own values under this version */
            problems: sortedEntries(own?.values ?? {}).flatMap(([key, value]) => {
                const problem = keyProblem(key, value, version.facts, version.policy, level);
                return problem ? [{ key, problem }] : [];
            }),
            writable: withinScope(unit.path, ctx.scopePath ?? '')
        };
    }

    /** The unit whose override changes: seen (else 404) and at or below the person's seat (else 403). */
    private async writableUnit(tx: Tx, ctx: DbContext, unitId: string): Promise<OrgUnit> {
        const unit = await this.visibleUnit(tx, unitId);
        if (!withinScope(unit.path, ctx.scopePath ?? ''))
            throw new ForbiddenError({ audit: { reason: 'service_override_above_scope', unit: unit.id } });
        return unit;
    }

    /**
     * Sets a unit's override (all its values: a PUT replaces it), based on the version read (If-Match; 0 for none). Each
     * key must be one the current version lets the unit's level change, and fit the version (a state, a field).
     */
    async setOverride(
        tx: Tx,
        ctx: DbContext,
        unitId: string,
        code: string,
        input: { values: Record<string, unknown>; reason: string },
        expectedVersion: number
    ) {
        const unit = await this.writableUnit(tx, ctx, unitId);
        const d = await this.definition(tx, unit.regionId, code);
        const v = await this.effectiveVersion(tx, d.id);
        if (!v) throw new ConflictError('not_configured', { detail: `${code} is not configured yet.` });
        const version = await this.versionConfig(tx, v);
        const values = configValuesSchema.parse(input.values);
        const level = unit.parentId === null ? 'region' : 'unit';
        const refused = Object.entries(values).flatMap(([key, value]) => {
            const problem = keyProblem(key, value, version.facts, version.policy, level);
            return problem ? [{ key, problem }] : [];
        });
        if (refused.some((r) => r.problem === 'not_allowed'))
            throw new ValidationError('setting_level_not_allowed', {
                detail: `The service's policy does not let this office change ${refused
                    .filter((r) => r.problem === 'not_allowed')
                    .map((r) => r.key)
                    .join(', ')}.`
            });
        if (refused.length)
            throw fieldErrors(
                refused.map((r) => ({ path: `values.${r.key}`, code: r.problem, message: `"${r.key}" does not fit.` }))
            );
        const [current] = await tx
            .select()
            .from(serviceOverrides)
            .where(and(eq(serviceOverrides.unitId, unit.id), eq(serviceOverrides.serviceId, d.id)))
            .for('update');
        if (current) {
            const saved = await updateAudited(tx, serviceOverrides, current.id, expectedVersion, {
                values,
                reason: input.reason
            });
            return { values: saved.values, reason: saved.reason, version: saved.rowVersion };
        }
        if (expectedVersion !== 0) throw stale(expectedVersion);
        try {
            const saved = await insertAudited(tx, serviceOverrides, {
                regionId: unit.regionId,
                unitId: unit.id,
                serviceId: d.id,
                values,
                reason: input.reason
            });
            return { values: saved.values, reason: saved.reason, version: saved.rowVersion };
        } catch (error) {
            if (isUniqueViolation(error)) throw stale(expectedVersion);
            throw error;
        }
    }

    async resetOverride(tx: Tx, ctx: DbContext, unitId: string, code: string, expectedVersion: number) {
        const unit = await this.writableUnit(tx, ctx, unitId);
        const d = await this.definition(tx, unit.regionId, code);
        const [current] = await tx
            .select()
            .from(serviceOverrides)
            .where(and(eq(serviceOverrides.unitId, unit.id), eq(serviceOverrides.serviceId, d.id)))
            .for('update');
        if (!current) throw new NotFoundError();
        await deleteAudited(tx, serviceOverrides, current.id, expectedVersion);
    }

    /**
     * A request for a service at the person's unit: the service must be offered there and configured; the case starts
     * on its effective version's workflow with the configuration resolved for the unit, frozen on the case.
     */
    async request(tx: Tx, ctx: DbContext, actor: CaseActor, code: string) {
        const unit = await this.visibleUnit(tx, ctx.unitId ?? '');
        const d = await this.definition(tx, unit.regionId, code);
        if (!d.active || !(await effectiveServices(tx, unit.id)).includes(code))
            throw new ConflictError('not_configured', { detail: `${code} is not offered by this office.` });
        const v = await this.effectiveVersion(tx, d.id);
        if (!v) throw new ConflictError('not_configured', { detail: `${code} is not configured yet.` });
        const version = await this.versionConfig(tx, v);
        const { chain } = await this.chainUnits(tx, unit, d.id);
        const config = frozenConfig(resolveConfig(version, chain), {
            serviceCode: code,
            serviceVersionId: v.id,
            formVersionId: v.formVersionId
        });
        const { id } = await this.cases.start(tx, ctx, { definitionVersionId: v.workflowVersionId, config });
        return this.cases.get(tx, actor, id);
    }
}

const sortedEntries = (values: Record<string, unknown>) =>
    Object.entries(values).sort(([a], [b]) => a.localeCompare(b));

const stale = (expectedVersion: number) =>
    new ConflictError('stale_version', { detail: `Version ${expectedVersion} was changed; read it again.` });

const isUniqueViolation = (error: unknown) => {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
        if ((e as { code?: string }).code === '23505') return true;
    return false;
};
