/**
 * The PDF worker's job (task 0.23a): on `document.render.v1`, a document's PDF is made from what was frozen when it was
 * issued, put in the store outside any transaction (Chrome and a large file never hold a connection), and recorded in one (the
 * row locked: a second delivery records nothing, and its object is removed). A template or data problem is the document's
 * and is kept on record; anything else (Chrome, the store) is thrown for the job to try again.
 */
import { and, eq } from 'drizzle-orm';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { actFor, updateAudited } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { putGeneratedObject, recordGeneratedFile, removeGeneratedObject, type ObjectStore } from '@itrms/kernel/files';

import { DOCUMENTS_EVENTS } from '../../contracts';
import { documentTemplates, documentTemplateVersions, issuedDocuments } from '../documents.table';
import type { PdfRenderer } from '../render/chrome';
import { renderHtml } from '../render/html';

export interface PdfWorkerDeps {
    store: ObjectStore;
    renderer: Pick<PdfRenderer, 'render'>;
}

/** Done: `rendered`; a document's own problem: `failed`; a delivery again: nothing. */
export async function renderIssuedDocument(
    system: SystemDatabase,
    deps: PdfWorkerDeps,
    documentId: string
): Promise<'rendered' | 'failed' | 'nothing'> {
    const found = await system.systemContext('documents.render_read', async (tx) => {
        const [row] = await tx
            .select({ document: issuedDocuments, version: documentTemplateVersions, key: documentTemplates.key })
            .from(issuedDocuments)
            .innerJoin(documentTemplateVersions, eq(documentTemplateVersions.id, issuedDocuments.templateVersionId))
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(eq(issuedDocuments.id, documentId));
        return row;
    });
    if (found?.document.state !== 'requested') return 'nothing';
    const { document, version, key } = found;

    const settle = (changes: { state: 'rendered' | 'failed'; failure?: string; fileId?: string; sha256?: string }) =>
        system.systemContext('documents.render_done', async (tx) => {
            const [row] = await tx
                .select()
                .from(issuedDocuments)
                .where(and(eq(issuedDocuments.id, documentId), eq(issuedDocuments.state, 'requested')))
                .for('update');
            if (!row) return false;
            actFor(tx, { regionId: row.regionId, unitId: row.handlingUnitId, scopePath: row.orgPath });
            await updateAudited(tx, issuedDocuments, row.id, row.rowVersion, changes);
            return true;
        });

    let html: string;
    try {
        html = await renderHtml({
            template: version,
            data: document.data,
            language: document.language,
            office: { name: document.officeName },
            header: document.header,
            issuedAt: document.createdAt
        });
    } catch {
        // the template can't print this data: rendering again would fail the same way
        await settle({ state: 'failed', failure: 'template' });
        return 'failed';
    }
    const body = await deps.renderer.render(html, version.paper);
    const object = await putGeneratedObject(deps.store, document.regionId, { contentType: 'application/pdf', body });
    try {
        const recorded = await system.systemContext('documents.render_done', async (tx) => {
            const [row] = await tx
                .select()
                .from(issuedDocuments)
                .where(and(eq(issuedDocuments.id, documentId), eq(issuedDocuments.state, 'requested')))
                .for('update');
            if (!row) return false;
            actFor(tx, { regionId: row.regionId, unitId: row.handlingUnitId, scopePath: row.orgPath });
            const file = await recordGeneratedFile(tx, { regionId: row.regionId, unitId: row.handlingUnitId }, object, {
                filename: `${key}-${row.number ?? row.id.slice(0, 8)}`.replace(/[^\p{L}\p{N}._-]+/gu, '-'),
                documentType: 'issued_document',
                link: { table: 'documents.issued_documents', id: row.id }
            });
            await updateAudited(tx, issuedDocuments, row.id, row.rowVersion, {
                state: 'rendered',
                fileId: file.id,
                sha256: object.sha256
            });
            return true;
        });
        if (!recorded) {
            await removeGeneratedObject(deps.store, object);
            return 'nothing';
        }
    } catch (error) {
        await removeGeneratedObject(deps.store, object);
        throw error;
    }
    return 'rendered';
}

export function pdfWorkerHandlers(system: SystemDatabase, deps: PdfWorkerDeps): Record<string, OutboxHandler> {
    return {
        'document.render.v1': async (job) => {
            await renderIssuedDocument(
                system,
                deps,
                DOCUMENTS_EVENTS['document.render.v1'].parse(job.payload).documentId
            );
        }
    };
}
