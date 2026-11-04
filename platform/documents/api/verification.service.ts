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

import { VERIFICATION_TOKEN, verificationOutSchema, type VerificationOut } from '../contracts';
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
