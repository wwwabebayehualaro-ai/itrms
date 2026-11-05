/**
 * What the public endpoint answers (ADR-0045, task 0.23b): a document's status by its token, a checker's minimum, checked against
 * its contract before it leaves. A token that is not one, and one that is unknown, are the same 404: nothing tells them apart.
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';
import type { I18nText } from '@itrms/schemas';

import {
    VERIFICATION_TOKEN,
    verificationKeysOutSchema,
    verificationOutSchema,
    type VerificationKeysOut,
    type VerificationOut
} from '../contracts';
import { addisDay } from './issue';
import { tokenHash } from './verification-token';

interface Row extends Record<string, unknown> {
    document_name: I18nText;
    number: string | null;
    office: I18nText;
    issued_on: string;
    valid_until: string | null;
    holder: string | null;
    revoked: boolean;
    superseded: boolean;
}

export const statusOf = (row: Pick<Row, 'revoked' | 'superseded' | 'valid_until'>, today: string) =>
    row.revoked
        ? ('revoked' as const)
        : row.superseded
          ? ('superseded' as const)
          : row.valid_until && row.valid_until < today
            ? ('expired' as const)
            : ('valid' as const);

@Injectable()
export class VerificationService {
    constructor(@Inject(DATABASE) private readonly db: Database) {}

    /** Every key's public half: public by definition, and what lets a phone prove a document offline (ADR-0046). */
    keys(): Promise<VerificationKeysOut> {
        return this.db.scoped({}, async (tx) => {
            const { rows } = await tx.execute<{ key_id: string; public_key: string; retired_on: string | null }>(
                sql`select key_id, public_key, retired_on::text as retired_on from documents.verification_keys()`
            );
            const names = await tx.execute<{ key: string; name: I18nText }>(
                sql`select key, name from documents.verification_document_names()`
            );
            return verificationKeysOutSchema.parse({
                documents: names.rows.map((n) => ({ key: n.key, name: n.name })),
                keys: rows.map((r) => ({ keyId: r.key_id, publicKey: r.public_key, retiredOn: r.retired_on }))
            });
        });
    }

    verify(token: string): Promise<VerificationOut> {
        if (!VERIFICATION_TOKEN.test(token)) throw new NotFoundError();
        return this.db.scoped({}, async (tx) => {
            // dates as the calendar days they are: the driver would make them instants
            const { rows } = await tx.execute<Row>(
                sql`select document_name, number, office, issued_on::text as issued_on, valid_until::text as valid_until,
                           holder, revoked, superseded
                      from documents.verification(${tokenHash(token)})`
            );
            const row = rows[0];
            if (!row) throw new NotFoundError();
            return verificationOutSchema.parse({
                status: statusOf(row, addisDay(new Date())),
                documentName: row.document_name,
                number: row.number,
                office: row.office,
                issuedOn: row.issued_on,
                validUntil: row.valid_until,
                holder: row.holder
            });
        });
    }
}
