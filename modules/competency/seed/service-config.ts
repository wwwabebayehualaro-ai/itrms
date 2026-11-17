/**
 * What the services of this module share as configuration (task 0.24b, 1.2b): the builders of forms and workflows, and the steps that
 * make a service's first version. No code here decides anything; see licence-services.ts and vehicle-services.ts.
 */
import { and, desc, eq } from 'drizzle-orm';
import { contentHash, insertAudited, updateAudited, type Tx } from '@itrms/kernel/db';
import { feeRuleApprovals, feeRules, feeRuleVersions } from '@itrms/fees/api';
import { formDefinitions, formVersions } from '@itrms/forms/api';
import { serviceDefinitions, serviceVersions } from '@itrms/services/api';
import { workflowDefinitions, workflowDefinitionVersions } from '@itrms/workflow/api';
import { workflowDefinitionSchema, type I18nText } from '@itrms/schemas';

import { addisDay } from '../contracts';

export const text = (am: string, en: string): I18nText => ({ am, en });

export const field = (
    id: string,
    type: string,
    label: I18nText,
    props: Record<string, unknown> = {},
    extra: Record<string, unknown> = {}
) => ({
    id,
    type,
    label,
    classification: 'personal',
    props: { required: true, ...props },
    behavior: { validation: { supported: true } },
    ...extra
});

export const FEE = { id: 'fee', type: 'Fee', category: 'Data', label: text('ክፍያ', 'Fee'), props: { showLines: true } };

/**
 * The documents of Art. 14(2) are kept as attachments, not required: the officer who reviews a case sees the paper, and an office with
 * no scanner still works. An office's forms can require them.
 */
export const attachment = (id: string, label: I18nText, classification = 'personal') =>
    field(id, 'FileUpload', label, { required: false }, { classification });

export const task = (key: string, label: I18nText, role: string, businessDays: number, extra: object = {}) => ({
    key,
    kind: 'task',
    label,
    assignee: { role, unit: 'handling' },
    sla: { businessDays },
    ...extra
});

export const PAID = { fact: 'payment.settled', op: 'eq', value: true };
export const REJECT_ROLES = ['competency.officer', 'competency.lead'];

export const ACTIONS = {
    approve: text('አጽድቅ', 'Approve'),
    pass: text('አልፏል', 'Passed'),
    fail: text('ወድቋል፣ እንደገና ይፈተን', 'Failed, to retake'),
    returnIt: text('ለማስተካከያ መልስ', 'Return for correction'),
    correct: text('አስተካክለህ አስገባ', 'Correct and resubmit')
};

/** Whoever filed a request may take it back while it is theirs: a refused one must not stay open for ever. */
export const WITHDRAW = {
    from: 'draft',
    to: 'rejected',
    action: 'withdraw',
    label: text('ጥያቄውን ሰርዝ', 'Withdraw the request'),
    commentRequired: true
};

export const DRAFT = { key: 'draft', kind: 'start', label: text('ረቂቅ', 'Draft') };
export const REVIEW_LABEL = text('ሰነድ ማጣራት', 'Document review');
/** The published form of this key, or this one published for the first time. A bureau's own version is never replaced. */
export async function publishedForm(
    tx: Tx,
    root: { id: string; regionId: string },
    key: string,
    name: I18nText,
    document: object
): Promise<{ versionId: string; number: number }> {
    const [existing] = await tx
        .select()
        .from(formDefinitions)
        .where(and(eq(formDefinitions.regionId, root.regionId), eq(formDefinitions.key, key)));
    if (existing?.publishedVersionId) {
        const [live] = await tx
            .select({ number: formVersions.number })
            .from(formVersions)
            .where(eq(formVersions.id, existing.publishedVersionId));
        return { versionId: existing.publishedVersionId, number: live?.number ?? 1 };
    }
    const hash = contentHash(document);
    const form =
        existing ??
        (await insertAudited(tx, formDefinitions, {
            regionId: root.regionId,
            ownerUnitId: root.id,
            key,
            name,
            document,
            documentHash: hash
        }));
    const version = await insertAudited(tx, formVersions, {
        regionId: root.regionId,
        ownerUnitId: root.id,
        formId: form.id,
        number: 1,
        contentHash: hash,
        document
    });
    await updateAudited(tx, formDefinitions, form.id, form.rowVersion, {
        document,
        documentHash: hash,
        publishedVersionId: version.id,
        publishedAt: new Date()
    });
    return { versionId: version.id, number: version.number };
}

export async function workflowVersion(
    tx: Tx,
    root: { id: string; regionId: string },
    key: string,
    name: I18nText,
    definition: unknown
): Promise<string> {
    const [existing] = await tx
        .select()
        .from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.regionId, root.regionId), eq(workflowDefinitions.key, key)));
    if (existing?.latestVersionId) return existing.latestVersionId;
    const parsed = workflowDefinitionSchema.parse(definition);
    const flow =
        existing ??
        (await insertAudited(tx, workflowDefinitions, {
            regionId: root.regionId,
            ownerUnitId: root.id,
            key,
            name
        }));
    const version = await insertAudited(tx, workflowDefinitionVersions, {
        regionId: root.regionId,
        ownerUnitId: root.id,
        definitionId: flow.id,
        number: 1,
        contentHash: contentHash(parsed),
        definition: parsed
    });
    await updateAudited(tx, workflowDefinitions, flow.id, flow.rowVersion, { latestVersionId: version.id });
    return version.id;
}

/** The region's newest approved version of a fee rule: a version still waiting for its second person can't be charged by. */
export async function approvedFeeRule(tx: Tx, regionId: string, key: string): Promise<string> {
    const [approved] = await tx
        .select({ id: feeRuleVersions.id })
        .from(feeRuleVersions)
        .innerJoin(feeRules, eq(feeRules.id, feeRuleVersions.ruleId))
        .innerJoin(feeRuleApprovals, eq(feeRuleApprovals.versionId, feeRuleVersions.id))
        .where(and(eq(feeRules.regionId, regionId), eq(feeRules.key, key), eq(feeRuleApprovals.decision, 'approved')))
        .orderBy(desc(feeRuleVersions.number))
        .limit(1);
    if (!approved) throw new Error(`fee rule ${key}: seed and approve the fee rules first`);
    return approved.id;
}

/** A service's first version. One that has any version already is the bureau's to change, and is left alone. */
export async function firstServiceVersion(
    tx: Tx,
    root: { id: string; regionId: string },
    service: typeof serviceDefinitions.$inferSelect,
    // no fee rule for a service that charges none (the back-capture of a paper file, MIG-01)
    parts: { formVersionId: string; workflowVersionId: string; feeRuleVersionId: string | null }
): Promise<void> {
    const content = {
        ...parts,
        defaults: { approval_unit: 'handling' },
        // a bureau, or an office below it, may say whose lead gives the final approval (docs/demo-plan.md, step 10), and whether
        // an office takes the fee at its till or it is paid at the revenue office (step 9: who collects is a bureau's call, §5)
        overridePolicy: { approval_unit: ['region', 'unit'], sla: ['region', 'unit'], payment: ['region', 'unit'] },
        inputMap: {},
        effectiveFrom: addisDay()
    };
    const version = await insertAudited(tx, serviceVersions, {
        regionId: root.regionId,
        serviceId: service.id,
        number: 1,
        contentHash: contentHash(content),
        ...content
    });
    await updateAudited(tx, serviceDefinitions, service.id, service.rowVersion, { currentVersionId: version.id });
}

/**
 * A seeded service whose current version a seed wrote, on an older flow of this workflow: a new workflow version and a new service
 * version on it, everything else kept (task 1.4b2; DVC-13 got its return to the letters and its timeout's revocation in 1.4b3). A
 * version a person published, or one on another workflow, is the bureau's, and is left alone; so is a flow that is already this
 * one. Cases keep the version they froze. Returns whether it made a version.
 */
export async function supersedeSeededVersion(
    tx: Tx,
    root: { id: string; regionId: string },
    service: typeof serviceDefinitions.$inferSelect,
    workflowKey: string,
    definition: unknown
): Promise<boolean> {
    if (!service.currentVersionId) return false;
    const [current] = await tx.select().from(serviceVersions).where(eq(serviceVersions.id, service.currentVersionId));
    if (!current || current.createdBy !== null) return false;
    const [running] = await tx
        .select({ version: workflowDefinitionVersions, flow: workflowDefinitions })
        .from(workflowDefinitionVersions)
        .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowDefinitionVersions.definitionId))
        .where(eq(workflowDefinitionVersions.id, current.workflowVersionId));
    if (!running || running.flow.key !== workflowKey || running.flow.regionId !== root.regionId) return false;
    // a version added to the workflow since (a bureau's edit, published or not) is theirs to publish: left alone
    if (running.flow.latestVersionId !== running.version.id) return false;
    const parsed = workflowDefinitionSchema.parse(definition);
    const hash = contentHash(parsed);
    if (running.version.contentHash === hash) return false;
    // today's flow may already be a version of the workflow: it is used again, never stored twice (as the designer does)
    const [stored] = await tx
        .select()
        .from(workflowDefinitionVersions)
        .where(
            and(
                eq(workflowDefinitionVersions.definitionId, running.flow.id),
                eq(workflowDefinitionVersions.contentHash, hash)
            )
        );
    const flowVersion =
        stored ??
        (await insertAudited(tx, workflowDefinitionVersions, {
            regionId: root.regionId,
            ownerUnitId: root.id,
            definitionId: running.flow.id,
            number:
                ((
                    await tx
                        .select({ number: workflowDefinitionVersions.number })
                        .from(workflowDefinitionVersions)
                        .where(eq(workflowDefinitionVersions.definitionId, running.flow.id))
                        .orderBy(desc(workflowDefinitionVersions.number))
                        .limit(1)
                )[0]?.number ?? 0) + 1,
            contentHash: hash,
            definition: parsed
        }));
    await updateAudited(tx, workflowDefinitions, running.flow.id, running.flow.rowVersion, {
        latestVersionId: flowVersion.id
    });
    const [lastService] = await tx
        .select({ number: serviceVersions.number, from: serviceVersions.effectiveFrom })
        .from(serviceVersions)
        .where(eq(serviceVersions.serviceId, service.id))
        .orderBy(desc(serviceVersions.number))
        .limit(1);
    const today = addisDay();
    const content = {
        formVersionId: current.formVersionId,
        workflowVersionId: flowVersion.id,
        feeRuleVersionId: current.feeRuleVersionId,
        defaults: current.defaults,
        overridePolicy: current.overridePolicy,
        inputMap: current.inputMap,
        // never before the version it follows: what cases froze is never rewritten
        effectiveFrom: lastService?.from && lastService.from > today ? lastService.from : today
    };
    const version = await insertAudited(tx, serviceVersions, {
        regionId: root.regionId,
        serviceId: service.id,
        number: (lastService?.number ?? 0) + 1,
        contentHash: contentHash(content),
        templateVersionIds: current.templateVersionIds,
        ...content
    });
    await updateAudited(tx, serviceDefinitions, service.id, service.rowVersion, { currentVersionId: version.id });
    return true;
}
