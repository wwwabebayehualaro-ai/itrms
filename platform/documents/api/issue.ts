/**
 * Issuing a document (task 0.23a), in the caller's transaction: the region's template, its newest version, the data checked
 * against the shape it names, and the unit's header as it is now, all frozen on the row. Rendering is never done here: the
 * event goes to the PDF worker's own queue. Issued twice for one record, it is the same document.
 */
import { and, eq } from 'drizzle-orm';
import { addisDate, isoDate } from '@itrms/ethiopian-calendar';
import { insertAudited, type Tx } from '@itrms/kernel/db';
import { ConflictError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';
import { emit } from '@itrms/kernel/outbox';
import type { SettingsService } from '@itrms/kernel/settings';
import type { I18nText } from '@itrms/schemas';

import { DOCUMENT_DATA_SCHEMAS, DOCUMENT_HEADER_SETTING, type DocumentHeader } from '../contracts';
import { documentTemplates, documentTemplateVersions, issuedDocuments } from './documents.table';

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
}

/** The day an instant falls on in Addis Ababa, as a stored day. */
export const addisDay = (instant: Date): string => isoDate(addisDate(instant));

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
            detail: `The document template ${input.templateKey} is not set up in this region.`
        });
    if (input.subject) {
        const [existing] = await tx
            .select()
            .from(issuedDocuments)
            .where(and(eq(issuedDocuments.templateId, template.id), eq(issuedDocuments.subjectId, input.subject.id)));
        if (existing) return existing;
    }
    const [version] = await tx
        .select({
            id: documentTemplateVersions.id,
            dataSchema: documentTemplateVersions.dataSchema
        })
        .from(documentTemplateVersions)
        .where(eq(documentTemplateVersions.id, template.latestVersionId));
    if (!version) throw new ConflictError('not_configured', { detail: 'The template has no version.' });
    const checked = DOCUMENT_DATA_SCHEMAS[version.dataSchema].safeParse(input.data);
    if (!checked.success)
        throw new ConflictError('contract_unmet', {
            detail: `The document ${input.templateKey} cannot be made from this data: ${checked.error.issues
                .map((i) => i.path.join('.'))
                .join(', ')}`
        });
    const header = await settings.value<DocumentHeader>(tx, input.handlingUnitId, DOCUMENT_HEADER_SETTING);
    const unit = (await unitRefs(tx, [input.handlingUnitId])).get(input.handlingUnitId);
    const issued = await insertAudited(tx, issuedDocuments, {
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
        header,
        officeName: (unit?.name ?? { am: '', en: '' }) as I18nText
    });
    await emit(
        tx,
        'document.render.v1',
        { documentId: issued.id },
        { unitId: input.handlingUnitId, regionId: input.regionId }
    );
    return issued;
}
