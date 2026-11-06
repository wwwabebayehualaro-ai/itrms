/**
 * The service catalogue at work (architecture.md §6.2, §7; task 0.21b). A region's bureau publishes a version of a
 * service (its form and workflow versions, defaults and override policy), checked against what it names; a unit below
 * overrides the keys the policy lets it; a request starts a case at the person's unit on the configuration resolved for
 * it, frozen on the case. A new version re-checks every override below the region and reports what no longer fits; the
 * overrides stay (a value that does not fit is passed over), and open cases keep what they froze.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { contentHash, deleteAudited, insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { EffectRegistry } from '@itrms/kernel/effects';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { effectiveServices, withinScope, type OrgUnit } from '@itrms/kernel/org';
import { orgUnits } from '@itrms/kernel/tables';
import {
    checkContract,
    contractLocks,
    feeAnswerContract,
    publishedKeysOf,
    readDocument
} from '@itrms/form-engine/core';
import { FEE_ASSESS_EFFECT, FEE_INPUTS, type FeeShown } from '@itrms/fees/contracts';
import { FeeRulesService, FeesService, type FeeRequest, type FeeRequestSource } from '@itrms/fees/api';
import {
    composedFor,
    formDefinitions,
    formVersions,
    materialize,
    RegistryLookups,
    SubmissionsService
} from '@itrms/forms/api';
import { CasesService, workflowDefinitions, workflowDefinitionVersions, type CaseActor } from '@itrms/workflow/api';
import { effectKeyOf, workflowDefinitionSchema, type I18nText, type InputMap } from '@itrms/schemas';
import { currentContext } from '@itrms/kernel/context';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';

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
import { contractFindings, contractMessage, effectsOf, ServiceFormGuard, servicesText } from './contracts';
import { serviceDefinitions, serviceOverrides, serviceVersions } from './services.table';

const currentLanguage = () => currentContext()?.language ?? 'am';

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
    feeRuleVersionId: string | null;
    defaults: Record<string, unknown>;
    overridePolicy: OverridePolicy;
    inputMap: InputMap;
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
    feeRuleVersionId: v.feeRuleVersionId,
    defaults: v.defaults,
    overridePolicy: overridePolicySchema.parse(v.overridePolicy),
    inputMap: v.inputMap,
    effectiveFrom: v.effectiveFrom,
    note: v.note,
    publishedAt: v.createdAt.toISOString()
});

@Injectable()
export class ServicesService implements FeeRequestSource {
    constructor(
        @Inject(EffectRegistry) private readonly effects: EffectRegistry,
        @Inject(CasesService) private readonly cases: CasesService,
        @Inject(SubmissionsService) private readonly submissions: SubmissionsService,
        @Inject(RegistryLookups) private readonly lookups: RegistryLookups,
        @Inject(FeeRulesService) private readonly feeRules: FeeRulesService,
        @Inject(FeesService) private readonly fees: FeesService,
        @Optional() @Inject(ServiceFormGuard) private readonly guard?: ServiceFormGuard
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

    /**
     * What a version is checked against: its workflow (its states, its effects) and its form (its field keys). On publish
     * (`regionPath`) both must be the region's own: a workflow or form a zone owns is not read by the other zones' offices,
     * and its owner could switch the whole region's service off. At a request, a workflow or form switched off since, or
     * an effect no longer installed, means the service cannot start (409), not a problem of what the person sent.
     */
    private async facts(
        tx: Tx,
        input: { workflowVersionId: string; formVersionId: string | null },
        regionPath?: string
    ): Promise<VersionFacts & { effects: string[]; formDocument: unknown; reassessed: boolean }> {
        try {
            return await this.checkedFacts(tx, input, regionPath);
        } catch (error) {
            if (regionPath === undefined && error instanceof ValidationError)
                throw new ConflictError('not_configured', {
                    detail: "The service's workflow or form is switched off, or names an effect no longer installed."
                });
            throw error;
        }
    }

    private async checkedFacts(
        tx: Tx,
        input: { workflowVersionId: string; formVersionId: string | null },
        regionPath?: string
    ): Promise<VersionFacts & { effects: string[]; formDocument: unknown; reassessed: boolean }> {
        const problems: { path: string; code: string; message: string }[] = [];
        const [workflow] = await tx
            .select({
                definition: workflowDefinitionVersions.definition,
                active: workflowDefinitions.active,
                orgPath: workflowDefinitions.orgPath
            })
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
        else if (regionPath !== undefined && workflow.orgPath !== regionPath)
            problems.push({
                path: 'workflowVersionId',
                code: 'workflow_not_regional',
                message: "The workflow is an office's own, not the region's."
            });
        let fieldKeys: string[] = [];
        let formDocument: unknown = null;
        if (input.formVersionId) {
            const [form] = await tx
                .select({
                    document: formVersions.document,
                    active: formDefinitions.active,
                    orgPath: formDefinitions.orgPath
                })
                .from(formVersions)
                .innerJoin(formDefinitions, eq(formDefinitions.id, formVersions.formId))
                .where(and(eq(formVersions.id, input.formVersionId), isNull(formVersions.baseVersionId)));
            if (!form) problems.push({ path: 'formVersionId', code: 'unknown_form', message: 'No such form version.' });
            else if (!form.active)
                problems.push({ path: 'formVersionId', code: 'form_off', message: 'The form is switched off.' });
            else if (regionPath !== undefined && form.orgPath !== regionPath)
                problems.push({
                    path: 'formVersionId',
                    code: 'form_not_regional',
                    message: "The form is an office's own, not the region's."
                });
            else {
                fieldKeys = [...publishedKeysOf(form.document).keys()];
                formDocument = form.document;
            }
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
        // a correction of the request changes its fee only through `fees.assess` on that transition (task 0.22a)
        const reassessed = definition.transitions.every(
            (t) => !t.amendsRequest || (t.effects ?? []).some((e) => effectKeyOf(e) === FEE_ASSESS_EFFECT)
        );
        return { ...factsOf(definition, fieldKeys), effects, formDocument, reassessed };
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
        const root = await this.atRoot(tx, ctx);
        const d = await this.definition(tx, ctx.regionId ?? '', code);
        const facts = await this.facts(tx, input, root.path);
        const problems: { path: string; code: string; message: string }[] = Object.entries(input.defaults).flatMap(
            ([key, value]) => {
                const problem = keyProblem(key, value, facts, input.overridePolicy, 'default');
                return problem
                    ? [{ path: `defaults.${key}`, code: problem, message: `"${key}" does not fit this version.` }]
                    : [];
            }
        );
        problems.push(...this.contractProblems(facts, input.inputMap, currentLanguage()));
        problems.push(...(await this.feeProblems(tx, facts, input, root.path, currentLanguage())));
        if (problems.length) throw fieldErrors(problems);
        const effectiveFrom = input.effectiveFrom ?? addisToday();
        // a version holds from today or later, never before the one before it: what cases froze is never rewritten, and
        // the newest version is the one that holds last
        const [latest] = await tx
            .select({ from: sql<string | null>`max(${serviceVersions.effectiveFrom})::text` })
            .from(serviceVersions)
            .where(eq(serviceVersions.serviceId, d.id));
        if (effectiveFrom < addisToday() || (latest?.from && effectiveFrom < latest.from))
            throw fieldErrors([
                {
                    path: 'effectiveFrom',
                    code: 'effective_too_early',
                    message: `A version holds from today${latest?.from ? ` and from ${latest.from}` : ''} or later.`
                }
            ]);
        const content = {
            formVersionId: input.formVersionId,
            workflowVersionId: input.workflowVersionId,
            feeRuleVersionId: input.feeRuleVersionId,
            defaults: input.defaults,
            overridePolicy: input.overridePolicy,
            inputMap: input.inputMap,
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
            feeRuleVersionId: input.feeRuleVersionId,
            defaults: input.defaults,
            overridePolicy: input.overridePolicy,
            inputMap: input.inputMap,
            effectiveFrom,
            note: input.note ?? null
        });
        const [fresh] = await tx.select().from(serviceDefinitions).where(eq(serviceDefinitions.id, d.id));
        if (fresh)
            await updateAudited(tx, serviceDefinitions, d.id, fresh.rowVersion, { currentVersionId: version.id });
        return { version: versionOut(version), conflicts: await this.conflicts(tx, d.id, facts, input.overridePolicy) };
    }

    /**
     * What the version's request form lacks for its effects' input contracts (task 0.21d), and input-map entries naming
     * an effect the workflow does not run; each said in the reader's language.
     */
    private contractProblems(
        facts: { effects: string[]; formDocument: unknown },
        inputMap: InputMap,
        language: string
    ): { path: string; code: string; message: string }[] {
        const out: { path: string; code: string; message: string }[] = [];
        for (const [effect, map] of Object.entries(inputMap)) {
            if (effect === FEE_INPUTS) continue;
            const contract = this.effects.contract(effect);
            if (!facts.effects.includes(effect))
                out.push({
                    path: `inputMap.${effect}`,
                    code: 'unknown_effect',
                    message: servicesText('services.contract.unknown_effect', language, { effect })
                });
            else if (!contract)
                out.push({
                    path: `inputMap.${effect}`,
                    code: 'no_contract',
                    message: servicesText('services.contract.no_contract', language, { effect })
                });
            else
                for (const path of Object.keys(map))
                    if (!(path in contract))
                        out.push({
                            path: `inputMap.${effect}.${path}`,
                            code: 'unknown_path',
                            message: servicesText('services.contract.unknown_path', language, { effect, key: path })
                        });
        }
        const reading = facts.effects.filter((e) => this.effects.contract(e) !== undefined);
        if (facts.formDocument === null) {
            for (const effect of reading)
                if (Object.values(this.effects.contract(effect) ?? {}).some((f) => f.required ?? true))
                    out.push({
                        path: 'formVersionId',
                        code: 'contract_no_form',
                        message: servicesText('services.contract.no_form', language, { effect })
                    });
            return out;
        }
        for (const { effect, problem } of contractFindings(
            reading,
            (e) => this.effects.contract(e),
            facts.formDocument,
            inputMap
        ))
            out.push({
                path: `inputMap.${effect}.${problem.path}`,
                code: `contract_${problem.code}`,
                message: contractMessage(effect, problem, language)
            });
        return out;
    }

    /**
     * What a version's fee rule (task 0.22a) refuses: the version must be approved, of an active rule of the region's own;
     * the request form must hold the rule's answer inputs as an effect's contract (through `inputMap['fees.rule']`), none
     * of them Sensitive (a preview is no audited read); every transition that changes the request works the fee out again;
     * a form showing a fee needs a rule.
     */
    private async feeProblems(
        tx: Tx,
        facts: { formDocument: unknown; reassessed: boolean },
        input: ServiceVersionInput,
        regionPath: string,
        language: string
    ): Promise<{ path: string; code: string; message: string }[]> {
        const out: { path: string; code: string; message: string }[] = [];
        const say = (path: string, code: string, values: Record<string, string> = {}) =>
            out.push({ path, code, message: servicesText(`services.contract.${code}`, language, values) });
        const fields = facts.formDocument === null ? [] : readDocument(facts.formDocument).fields;
        if (input.feeRuleVersionId === null) {
            if (fields.some((f) => f.type === 'Fee')) say('feeRuleVersionId', 'fee_field_without_rule');
            if (input.inputMap[FEE_INPUTS]) say(`inputMap.${FEE_INPUTS}`, 'unknown_effect', { effect: FEE_INPUTS });
            return out;
        }
        const usable = await this.feeRules.usable(tx, input.feeRuleVersionId, regionPath);
        if (!usable.ok) {
            say('feeRuleVersionId', usable.problem);
            return out;
        }
        const contract = feeAnswerContract(usable.rule.rule);
        const map = input.inputMap[FEE_INPUTS];
        for (const path of Object.keys(map ?? {}))
            if (!(path in contract))
                say(`inputMap.${FEE_INPUTS}.${path}`, 'unknown_path', { effect: FEE_INPUTS, key: path });
        if (facts.formDocument === null) {
            if (Object.values(contract).some((c) => c.required ?? true))
                say('formVersionId', 'no_form', { effect: FEE_INPUTS });
        } else {
            // the preview reads the inputs alone: each settles the same with or without the rest of the form
            for (const problem of checkContract(contract, facts.formDocument, map, { standalone: true }))
                out.push({
                    path: `inputMap.${FEE_INPUTS}.${problem.path}`,
                    code: `contract_${problem.code}`,
                    message: contractMessage(FEE_INPUTS, problem, language)
                });
            const byKey = new Map(fields.map((f) => [f.id, f]));
            const chainOf = (f: (typeof fields)[number] | undefined) => {
                const out: (typeof fields)[number][] = [];
                for (let p = f; p; p = p.parentId ? byKey.get(p.parentId) : undefined) out.push(p);
                return out;
            };
            // Sensitive by itself or by a container it sits in
            for (const path of Object.keys(contract)) {
                const key = map?.[path] ?? path;
                if (chainOf(byKey.get(key)).some((f) => f.classification === 'sensitive'))
                    say(`inputMap.${FEE_INPUTS}.${path}`, 'fee_input_sensitive', { key });
            }
            // the counter sees the fee it files: a Fee field, always shown, to every role
            const shown = fields.filter((f) => f.type === 'Fee' && !chainOf(f).some((p) => p.removed));
            if (shown.length === 0) say('formVersionId', 'fee_field_missing');
            else if (
                !shown.some((f) =>
                    chainOf(f).every(
                        (p) =>
                            p.visibleWhen.length === 0 &&
                            p.enabledWhen.length === 0 &&
                            (p.visibleToRoles?.length ?? 0) === 0
                    )
                )
            )
                say('formVersionId', 'fee_field_conditional');
        }
        if (!facts.reassessed) say('workflowVersionId', 'fee_not_reassessed', { effect: FEE_ASSESS_EFFECT });
        return out;
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
        // the steps an SLA may be set for, with their labels (the override editor names them)
        const [workflow] = await tx
            .select({ definition: workflowDefinitionVersions.definition })
            .from(workflowDefinitionVersions)
            .where(eq(workflowDefinitionVersions.id, v.workflowVersionId));
        const parsed = workflowDefinitionSchema.safeParse(workflow?.definition);
        const states = parsed.success
            ? parsed.data.states
                  .filter((st) => version.facts.timedStates.has(st.key))
                  .map((st) => ({ key: st.key, label: st.label ?? null }))
            : [];
        return {
            serviceCode: code,
            version: versionOut(v),
            states,
            fields: [...version.facts.fieldKeys].sort(),
            values: Object.fromEntries([...resolved].map(([key, r]) => [key, r])),
            own: own ? { values: own.values, reason: own.reason, version: own.rowVersion } : null,
            /** the problems of the unit's own values under this version */
            problems: sortedEntries(own?.values ?? {}).flatMap(([key, value]) => {
                const problem = keyProblem(key, value, version.facts, version.policy, level);
                return problem ? [{ key, problem }] : [];
            }),
            // strictly below the seat, as writableUnit (the region at its own root)
            writable:
                withinScope(unit.path, ctx.scopePath ?? '') && !(unit.path === ctx.scopePath && unit.parentId !== null)
        };
    }

    /**
     * The unit whose override changes: seen (else 404), and strictly below the person's seat (else 403): an office never
     * loosens its own deadlines, as it never widens its own services; the region decides its own at its root.
     */
    private async writableUnit(tx: Tx, ctx: DbContext, unitId: string): Promise<OrgUnit> {
        const unit = await this.visibleUnit(tx, unitId);
        const scope = ctx.scopePath ?? '';
        if (!withinScope(unit.path, scope) || (unit.path === scope && unit.parentId !== null))
            throw new ForbiddenError({ audit: { reason: 'service_override_own_or_above', unit: unit.id } });
        return unit;
    }

    /** The versions an override must fit: the one in effect and any published to come into effect later. */
    private async versionsToFit(tx: Tx, serviceId: string): Promise<Version[]> {
        const effective = await this.effectiveVersion(tx, serviceId);
        const later = await tx
            .select()
            .from(serviceVersions)
            .where(
                and(eq(serviceVersions.serviceId, serviceId), sql`${serviceVersions.effectiveFrom} > ${addisToday()}`)
            );
        return [...(effective ? [effective] : []), ...later];
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
        const versions = await this.versionsToFit(tx, d.id);
        if (!versions.length) throw new ConflictError('not_configured', { detail: `${code} is not configured yet.` });
        const values = configValuesSchema.parse(input.values);
        const level = unit.parentId === null ? 'region' : 'unit';
        // each value must fit the version in effect and those to come (else it would quietly stop holding)
        const refused: { key: string; problem: OverrideConflict['problem'] }[] = [];
        for (const v of versions) {
            const version = await this.versionConfig(tx, v);
            for (const [key, value] of sortedEntries(values)) {
                const problem = keyProblem(key, value, version.facts, version.policy, level);
                if (problem && !refused.some((r) => r.key === key)) refused.push({ key, problem });
            }
        }
        // the office above it: a region's root has none, and its cases' final approval could never be given
        if (
            values.approval_unit === 'parent' &&
            unit.parentId === null &&
            !refused.some((r) => r.key === 'approval_unit')
        )
            refused.push({ key: 'approval_unit', problem: 'invalid_value' });
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
    /** The service as the person's unit offers it today: its version in effect, its configuration for the unit. */
    private async offered(tx: Tx, ctx: DbContext, code: string) {
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
            serviceName: d.name,
            serviceVersionId: v.id,
            formVersionId: v.formVersionId,
            inputMap: v.inputMap,
            feeRuleVersionId: v.feeRuleVersionId
        });
        const [form] = v.formVersionId
            ? await tx
                  .select({
                      formId: formVersions.formId,
                      versionId: formVersions.id,
                      number: formVersions.number,
                      document: formVersions.document
                  })
                  .from(formVersions)
                  .where(eq(formVersions.id, v.formVersionId))
            : [];
        // the units' overlays the policy lets apply here (task 0.21f), composed onto the service's form version; the
        // fields its effects read are locked (an overlay never narrows them)
        const levels = new Set(version.policy.formOverlay ?? []);
        const composed =
            form && levels.size > 0
                ? await (async () => {
                      const [definition] = await tx
                          .select({ id: formDefinitions.id, ownerUnitId: formDefinitions.ownerUnitId })
                          .from(formDefinitions)
                          .where(eq(formDefinitions.id, form.formId));
                      if (!definition) return null;
                      // every field an effect locks (mapped or by its own key): of this version, the one filed on,
                      // and of every service reading the form at its current version (the guard's)
                      const [workflow] = await tx
                          .select({ definition: workflowDefinitionVersions.definition })
                          .from(workflowDefinitionVersions)
                          .where(eq(workflowDefinitionVersions.id, v.workflowVersionId));
                      const own = effectsOf(workflow?.definition).flatMap((effect) => {
                          const contract = this.effects.contract(effect);
                          return contract ? contractLocks(contract, v.inputMap[effect]).map((l) => l.key) : [];
                      });
                      // and the fee rule's inputs (task 0.22a)
                      if (v.feeRuleVersionId)
                          own.push(
                              ...contractLocks(
                                  feeAnswerContract((await this.feeRules.stored(tx, v.feeRuleVersionId)).rule),
                                  v.inputMap[FEE_INPUTS]
                              ).map((l) => l.key)
                          );
                      const locks = new Set([
                          ...own,
                          ...(this.guard ? (await this.guard.locks(tx, form.formId)).map((l) => l.key) : [])
                      ]);
                      return composedFor(
                          tx,
                          definition,
                          { id: form.versionId, document: form.document },
                          unit.path,
                          locks,
                          (path) => levels.has(path.split('.').length <= 2 ? 'region' : 'unit')
                      );
                  })()
                : null;
        return {
            unit,
            d,
            v,
            config,
            form: form
                ? { formId: form.formId, versionId: form.versionId, number: form.number, document: form.document }
                : null,
            composed: composed && composed.layers.length > 0 ? composed : null
        };
    }

    /** What the counter fills in for a request (task 0.21c): the service's form version and its help texts here. */
    async requestForm(tx: Tx, ctx: DbContext, code: string) {
        const { d, v, config, form, composed } = await this.offered(tx, ctx, code);
        return {
            serviceCode: code,
            name: d.name as I18nText,
            versionNumber: v.number,
            form: form ? { formId: form.formId, versionId: form.versionId } : null,
            // the form as this office fills it in: with its overlays (none: the service's version as it is)
            document: composed?.document ?? null,
            help: config.help
        };
    }

    /**
     * A request for a service at the person's unit: the service must be offered there and configured; the case starts
     * on its effective version's workflow with the configuration resolved for the unit, frozen on the case, and the
     * request form's answers (validated on the server on the version the service names) are filed with it in the same
     * transaction: a refused answer starts no case.
     */
    async request(
        tx: Tx,
        ctx: DbContext,
        actor: CaseActor,
        code: string,
        answers: Record<string, unknown> | undefined,
        language: string,
        fee?: FeeShown
    ) {
        const { unit, v, config, form, composed } = await this.offered(tx, ctx, code);
        if (form && answers === undefined)
            throw fieldErrors([
                { path: 'answers', code: 'required', message: 'The service has a request form to fill in.' }
            ]);
        if (!form && answers !== undefined)
            throw fieldErrors([{ path: 'answers', code: 'invalid', message: 'The service has no request form.' }]);
        // the request is filed on the form as this office has it (its overlays composed in): stored once, then frozen
        const formVersionId =
            form && composed
                ? await materialize(
                      tx,
                      { id: form.formId },
                      { id: form.versionId, number: form.number },
                      unit,
                      composed
                  )
                : (form?.versionId ?? null);
        const frozen =
            form && composed && formVersionId
                ? {
                      ...config,
                      formVersionId,
                      baseFormVersionId: form.versionId,
                      overlayVersionIds: composed.layers.map((l) => l.versionId)
                  }
                : config;
        const { id } = await this.cases.start(tx, ctx, { definitionVersionId: v.workflowVersionId, config: frozen });
        const filed =
            form && answers && formVersionId
                ? await this.submissions.create(
                      tx,
                      ctx,
                      actor.roles,
                      { formId: form.formId, formVersionId, answers },
                      this.lookups,
                      language,
                      { caseId: id, handlingUnitId: unit.id }
                  )
                : null;
        // a fee shown for a version that no longer charges one: the clerk sees that first
        if (!v.feeRuleVersionId && fee)
            throw new ConflictError('fee_changed', { detail: 'The service charges no fee now.' });
        // the fee worked out from the answers as filed, kept with the case in its transaction (task 0.22a)
        if (v.feeRuleVersionId)
            await this.fees.assessFiled(
                tx,
                { caseId: id, regionId: unit.regionId, handlingUnitId: unit.id, submissionId: filed?.id ?? null },
                {
                    serviceVersionId: v.id,
                    feeRuleVersionId: v.feeRuleVersionId,
                    inputMap: v.inputMap[FEE_INPUTS] ?? {},
                    answers: filed?.answers ?? {}
                },
                fee,
                language,
                // a request with a form shows its fee (publication requires a Fee field): it is filed at the figure seen
                form !== null
            );
        return this.cases.get(tx, actor, id);
    }

    /**
     * The fee preview's request (FeeRequestSource): the service as the person's unit offers it today, and the answers as
     * filing would store them on the form this office fills in.
     */
    async feeRequest(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        code: string,
        answers: Record<string, unknown>,
        language: string
    ): Promise<FeeRequest> {
        const { v, form, composed } = await this.offered(tx, ctx, code);
        const document = composed?.document ?? form?.document ?? null;
        return {
            serviceVersionId: v.id,
            feeRuleVersionId: v.feeRuleVersionId,
            inputMap: v.inputMap[FEE_INPUTS] ?? {},
            answers: document === null ? {} : this.submissions.settledAnswers(ctx, roles, document, answers, language)
        };
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
