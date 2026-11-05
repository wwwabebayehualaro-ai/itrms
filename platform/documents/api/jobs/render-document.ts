/**
 * The PDF worker's job (task 0.23a): on `document.render.v1`, a document's PDF is made from what was frozen when it was
 * issued, put in the store outside any transaction (Chrome and a large file never hold a connection), and recorded in one (the
 * row locked: a second delivery records nothing, and its object is removed). A problem in the template itself is the
 * document's, kept on record and not tried again; anything else (Chrome, the store, the fonts) is thrown for the job to retry.
 */
import { and, eq } from 'drizzle-orm';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { actFor, updateAudited, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { putGeneratedObject, recordGeneratedFile, removeGeneratedObject, type ObjectStore } from '@itrms/kernel/files';

import { orgUnits } from '@itrms/kernel/tables';
import type { FieldCrypto } from '@itrms/kernel/crypto';

import { DOCUMENTS_EVENTS, payloadBytes, signedBytes, verificationUrl } from '../../contracts';
import { documentTemplates, documentTemplateVersions, issuedDocuments } from '../documents.table';
import { addisDay } from '../issue';
import { tokenHash } from '../verification-token';
import type { PdfRenderer } from '../render/chrome';
import { isTemplateProblem, renderHtml } from '../render/html';
import { currentSigningKey, newVerificationToken, qrImage, signPayload } from './signing';
import { factsOf, maskedName } from '../verification-facts';

export interface PdfWorkerDeps {
    store: ObjectStore;
    renderer: Pick<PdfRenderer, 'render'>;
    /** the installation's key-encryption key, for the region's signing key */
    crypto: Pick<FieldCrypto, 'wrapSecret' | 'unwrapSecret'>;
    /** where a QR points: the public verification host */
    verifyBaseUrl: string;
}

type IssuedRow = typeof issuedDocuments.$inferSelect;

/** In a transaction: the document still waiting, locked, with the transaction acting for its unit; else nothing happens. */
const whileRequested = <T>(
    system: SystemDatabase,
    documentId: string,
    work: (tx: Tx, row: IssuedRow) => Promise<T>
): Promise<T | undefined> =>
    system.systemContext('documents.render_done', async (tx) => {
        const [row] = await tx
            .select()
            .from(issuedDocuments)
            .where(and(eq(issuedDocuments.id, documentId), eq(issuedDocuments.state, 'requested')))
            .for('update');
        if (!row) return undefined;
        actFor(tx, { regionId: row.regionId, unitId: row.handlingUnitId, scopePath: row.orgPath });
        return work(tx, row);
    });

/** Done: `rendered`; a template's own problem: `failed`; a delivery again: nothing. */
export async function renderIssuedDocument(
    system: SystemDatabase,
    deps: PdfWorkerDeps,
    documentId: string
): Promise<'rendered' | 'failed' | 'nothing'> {
    const found = await system.systemContext('documents.render_read', async (tx) => {
        const [row] = await tx
            .select({
                document: issuedDocuments,
                version: documentTemplateVersions,
                key: documentTemplates.key,
                officeCode: orgUnits.code
            })
            .from(issuedDocuments)
            .innerJoin(documentTemplateVersions, eq(documentTemplateVersions.id, issuedDocuments.templateVersionId))
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .innerJoin(orgUnits, eq(orgUnits.id, issuedDocuments.handlingUnitId))
            .where(eq(issuedDocuments.id, documentId));
        return row;
    });
    if (found?.document.state !== 'requested') return 'nothing';
    const { document, version, key } = found;

    // the QR: a fresh token, and only its hash kept; a retry signs again, and only the attempt that records counts
    const signing = await currentSigningKey(system, deps.crypto, document.regionId);
    const token = newVerificationToken();
    const facts = factsOf(version.dataSchema, document.data);
    const issuedOn = addisDay(document.createdAt);
    const payload = payloadBytes({
        v: 1,
        k: signing.keyId,
        t: key,
        n: document.number,
        o: found.officeCode,
        i: issuedOn,
        u: facts.validUntil,
        h: facts.holder ? maskedName(facts.holder) : null
    });
    const url = verificationUrl(deps.verifyBaseUrl, token, payload, signPayload(signing, signedBytes(token, payload)));
    const verification = { url, qr: await qrImage(url) };

    let html: string;
    try {
        html = await renderHtml({
            template: version,
            data: document.data,
            language: document.language,
            office: { name: document.officeName },
            header: document.header,
            issuedAt: document.createdAt,
            verification
        });
    } catch (error) {
        if (!isTemplateProblem(error)) throw error;
        // the template can't print this: rendering again would fail the same way
        await whileRequested(system, documentId, (tx, row) =>
            updateAudited(tx, issuedDocuments, row.id, row.rowVersion, { state: 'failed', failure: 'template' })
        );
        return 'failed';
    }
    // a template that doesn't print it (an older version not yet replaced): nothing can ever scan that token, so none is kept
    const printsQr = html.includes(verification.qr);
    const body = await deps.renderer.render(html, version.paper);
    const object = await putGeneratedObject(deps.store, document.regionId, { contentType: 'application/pdf', body });
    try {
        const recorded = await whileRequested(system, documentId, async (tx, row) => {
            const file = await recordGeneratedFile(tx, { regionId: row.regionId, unitId: row.handlingUnitId }, object, {
                filename: `${key}-${row.number ?? row.id.slice(0, 8)}`.replace(/[^\p{L}\p{N}._-]+/gu, '-'),
                documentType: 'issued_document',
                link: { table: 'documents.issued_documents', id: row.id }
            });
            await updateAudited(tx, issuedDocuments, row.id, row.rowVersion, {
                state: 'rendered',
                fileId: file.id,
                sha256: object.sha256,
                ...(printsQr ? { verificationTokenHash: tokenHash(token), signingKeyId: signing.id } : {})
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
