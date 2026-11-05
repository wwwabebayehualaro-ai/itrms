/**
 * Documents as the API serves them (task 0.23a), and issuing for a work process's own effects. A reprint is the stored
 * PDF, through a short-lived link, on record: nothing is rendered again.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { recordEvent, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError } from '@itrms/kernel/errors';
import { downloadLinkedFile, type ObjectStore } from '@itrms/kernel/files';
import { SettingsService } from '@itrms/kernel/settings';

import type { IssuedDocumentOut } from '../contracts';
import { documentTemplates, issuedDocuments } from './documents.table';
import { issueDocument, revokeDocument, supersedeDocument, type IssueInput, type IssuedRow } from './issue';

/** The same values, however each was stored: PostgreSQL keeps a jsonb's keys in an order of its own. */
const sameData = (a: unknown, b: unknown): boolean => {
    const sorted = (value: unknown): unknown =>
        Array.isArray(value)
            ? value.map(sorted)
            : value !== null && typeof value === 'object'
              ? Object.fromEntries(
                    Object.entries(value)
                        .sort(([x], [y]) => x.localeCompare(y))
                        .map(([k, v]) => [k, sorted(v)])
                )
              : value;
    return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
};

@Injectable()
export class DocumentsService {
    constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

    /** Issues a document in the caller's transaction: for a work process's effect. */
    issue(tx: Tx, input: IssueInput): Promise<IssuedRow> {
        return issueDocument(tx, this.settings, input);
    }

    /**
     * The document of a record that changes (a renewed licence's card): a new one, if it says anything new, whose QR replaces the old
     * one's. The same data again is the same document.
     */
    async reissue(tx: Tx, input: IssueInput & { subject: NonNullable<IssueInput['subject']> }): Promise<IssuedRow> {
        const current = await issueDocument(tx, this.settings, input);
        if (sameData(current.data, input.data)) return current;
        return supersedeDocument(tx, this.settings, current.id, {
            data: input.data,
            language: input.language,
            ...(input.number ? { number: input.number } : {})
        });
    }

    /** A correction: the old document's QR says superseded from now on. */
    supersede(tx: Tx, oldId: string, correction: Pick<IssueInput, 'data' | 'language' | 'number'>): Promise<IssuedRow> {
        return supersedeDocument(tx, this.settings, oldId, correction);
    }

    /** A document that no longer holds. */
    revoke(tx: Tx, row: IssuedRow, reason: string): Promise<void> {
        return revokeDocument(tx, row, reason);
    }

    /** The documents the person sees of a case or a record, newest first. */
    async list(tx: Tx, query: { caseId?: string; subjectId?: string }): Promise<IssuedDocumentOut[]> {
        const rows = await tx
            .select()
            .from(issuedDocuments)
            .where(
                and(
                    query.caseId ? eq(issuedDocuments.caseId, query.caseId) : undefined,
                    query.subjectId ? eq(issuedDocuments.subjectId, query.subjectId) : undefined
                )
            )
            .orderBy(desc(issuedDocuments.createdAt))
            .limit(100);
        if (rows.length === 0) return [];
        const templates = await tx
            .select({ id: documentTemplates.id, key: documentTemplates.key, name: documentTemplates.name })
            .from(documentTemplates)
            .where(
                inArray(
                    documentTemplates.id,
                    rows.map((r) => r.templateId)
                )
            );
        const of = new Map(templates.map((t) => [t.id, t]));
        return rows.map((r) => ({
            id: r.id,
            templateKey: of.get(r.templateId)?.key ?? '',
            templateName: of.get(r.templateId)?.name ?? { am: '', en: '' },
            number: r.number,
            caseId: r.caseId,
            language: r.language,
            state: r.state,
            failure: r.failure,
            revoked: r.revokedAt !== null,
            superseded: r.supersededBy !== null,
            issuedAt: r.createdAt.toISOString()
        }));
    }

    /** The stored PDF: 404 for what the person can't see, 409 until it has been made. */
    async download(tx: Tx, store: ObjectStore, id: string, notReady: string) {
        const [row] = await tx.select().from(issuedDocuments).where(eq(issuedDocuments.id, id));
        if (!row) throw new NotFoundError();
        if (row.state !== 'rendered' || !row.fileId)
            throw new ConflictError('invalid_transition', { detail: notReady });
        const link = await downloadLinkedFile(tx, store, row.fileId, {
            table: 'documents.issued_documents',
            id: row.id
        });
        await recordEvent(tx, { type: 'document.printed', table: issuedDocuments, rowId: row.id });
        return link;
    }
}
