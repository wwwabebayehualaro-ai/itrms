/**
 * Issuing a document (task 0.23a), in the caller's transaction: the region's template, its newest version, the data checked
 * against the shape it names, and the unit's header as it is now, all frozen on the row. Rendering is never done here: the
 * event goes to the PDF worker's own queue. Issued twice for one record, it is the same document.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { addisDate, isoDate } from '@itrms/ethiopian-calendar';
import { insertAudited, newId, updateAudited, type Tx } from '@itrms/kernel/db';
import { BRAND_NAME_SETTING } from '@itrms/kernel/contracts';
import { ConflictError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';
import { emit } from '@itrms/kernel/outbox';
import type { SettingsService } from '@itrms/kernel/settings';
import type { I18nText } from '@itrms/schemas';

import { DOCUMENT_DATA_SCHEMAS, DOCUMENT_HEADER_SETTING, type DocumentHeader } from '../contracts';
import { documentTemplates, documentTemplateVersions, issuedDocuments } from './documents.table';
import { factsOf, maskedName } from './verification-facts';

export type IssuedRow = typeof issuedDocuments.$inferSelect;

export interface IssueInput {
    regionId: string;
    handlingUnitId: string;
    templateKey: string;
    data: Record<string, unknown>;
    language: string;
    caseId?: string;
    subject?: { table: string; id: string };
    number?: string;
    /** a correction names its own id first: the old document points at it */
    id?: string;
}

/** The day an instant falls on in Addis Ababa, as a stored day. */
export const addisDay = (instant: Date): string => isoDate(addisDate(instant));

const insertIssued = async (tx: Tx, values: typeof issuedDocuments.$inferInsert): Promise<IssuedRow> => {
    try {
        return await insertAudited(tx, issuedDocuments, values);
    } catch (error) {
        // issued already by an office this person can't see, or at the same moment: never a raw database error
        for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
            if ((e as { constraint?: string }).constraint === 'issued_documents_subject_uq')
                throw new ConflictError('invalid_transition', {
                    detailKey: 'documents.errors.already_issued',
                    cause: error
                });
        throw error;
    }
};

export async function issueDocument(
    tx: Tx,
    settings: Pick<SettingsService, 'value'>,
    input: IssueInput
): Promise<IssuedRow> {
    const [template] = await tx
        .select()
        .from(documentTemplates)
        .where(and(eq(documentTemplates.regionId, input.regionId), eq(documentTemplates.key, input.templateKey)));
    if (!template?.latestVersionId)
        throw new ConflictError('not_configured', {
            detailKey: 'documents.errors.template_not_set_up',
            params: { template: input.templateKey }
        });
    if (input.subject) {
        const [existing] = await tx
            .select()
            .from(issuedDocuments)
            .where(
                and(
                    eq(issuedDocuments.templateId, template.id),
                    eq(issuedDocuments.subjectId, input.subject.id),
                    isNull(issuedDocuments.supersededBy)
                )
            );
        if (existing) return existing;
    }
    const [version] = await tx
        .select({
            id: documentTemplateVersions.id,
            dataSchema: documentTemplateVersions.dataSchema
        })
        .from(documentTemplateVersions)
        .where(eq(documentTemplateVersions.id, template.latestVersionId));
    if (!version) throw new ConflictError('not_configured', { detailKey: 'documents.errors.template_no_version' });
    const checked = DOCUMENT_DATA_SCHEMAS[version.dataSchema].safeParse(input.data);
    if (!checked.success)
        throw new ConflictError('contract_unmet', {
            detailKey: 'documents.errors.data_invalid',
            params: {
                template: input.templateKey,
                fields: checked.error.issues.map((i) => i.path.join('.')).join(', ')
            }
        });
    const facts = factsOf(version.dataSchema, checked.data);
    // the bureau's own name heads its documents, unless the header names another (a zone department's, say)
    const stored = await settings.value<DocumentHeader>(tx, input.handlingUnitId, DOCUMENT_HEADER_SETTING);
    const brand = stored.title
        ? null
        : await settings.value<I18nText | null>(tx, input.handlingUnitId, BRAND_NAME_SETTING);
    const header: DocumentHeader = brand ? { ...stored, title: brand } : stored;
    const unit = (await unitRefs(tx, [input.handlingUnitId])).get(input.handlingUnitId);
    // frozen on the document for good: a blank office would print on it, and fail its public check, for ever
    if (!unit) throw new ConflictError('not_configured', { detailKey: 'documents.errors.issuing_office_unreadable' });
    const issued = await insertIssued(tx, {
        ...(input.id ? { id: input.id } : {}),
        regionId: input.regionId,
        handlingUnitId: input.handlingUnitId,
        templateId: template.id,
        templateVersionId: version.id,
        caseId: input.caseId ?? null,
        subjectTable: input.subject?.table ?? null,
        subjectId: input.subject?.id ?? null,
        number: input.number ?? null,
        language: input.language,
        data: checked.data,
        holderMask: facts.holder ? maskedName(facts.holder) : null,
        validUntil: facts.validUntil,
        header,
        officeName: unit.name as I18nText
    });
    await emit(
        tx,
        'document.render.v1',
        { documentId: issued.id },
        { unitId: input.handlingUnitId, regionId: input.regionId }
    );
    return issued;
}

/** A document that no longer holds: its QR reports it from now on. Once; the reason stays. */
export async function revokeDocument(tx: Tx, row: IssuedRow, reason: string): Promise<void> {
    if (row.revokedAt) return;
    await updateAudited(tx, issuedDocuments, row.id, row.rowVersion, { revokedAt: new Date(), revokeReason: reason });
}

/**
 * A correction: the document as it should be, in the caller's transaction, and the old one marked as superseded by it, so its
 * QR says so. The old file stays: what was printed then is still on record.
 */
export async function supersedeDocument(
    tx: Tx,
    settings: Pick<SettingsService, 'value'>,
    oldId: string,
    /** what it should say: its template and the record it documents are the old one's, and so are its case and office unless named */
    correction: Pick<IssueInput, 'data' | 'language' | 'number'> &
        Partial<Pick<IssueInput, 'caseId' | 'handlingUnitId'>>
): Promise<IssuedRow> {
    const [old] = await tx.select().from(issuedDocuments).where(eq(issuedDocuments.id, oldId)).for('update');
    if (!old) throw new ConflictError('invalid_transition', { detailKey: 'documents.errors.no_document_to_correct' });
    if (old.supersededBy || old.revokedAt)
        throw new ConflictError('invalid_transition', {
            detailKey: 'documents.errors.document_not_standing'
        });
    // the old one first: only one document of a record stands at a time. Its key to the new one is checked at commit
    const [template] = await tx
        .select({ key: documentTemplates.key })
        .from(documentTemplates)
        .where(eq(documentTemplates.id, old.templateId));
    if (!template) throw new ConflictError('not_configured', { detailKey: 'documents.errors.template_gone' });
    const id = newId();
    await updateAudited(tx, issuedDocuments, old.id, old.rowVersion, { supersededBy: id });
    return issueDocument(tx, settings, {
        ...correction,
        id,
        templateKey: template.key,
        regionId: old.regionId,
        handlingUnitId: correction.handlingUnitId ?? old.handlingUnitId,
        ...(correction.caseId || old.caseId ? { caseId: correction.caseId ?? old.caseId ?? undefined } : {}),
        ...(old.subjectTable && old.subjectId ? { subject: { table: old.subjectTable, id: old.subjectId } } : {})
    });
}
