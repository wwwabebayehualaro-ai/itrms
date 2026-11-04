/**
 * The public verification endpoint (ADR-0045, task 0.23b): no sign-in, and only a checker's minimum. A token that is not one,
 * and one that is unknown, answer the same 404: nothing tells one from the other. Nginx on `verify.<domain>` is the only way
 * here from outside, rate-limited; it proxies this path and nothing else.
 */
import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { addisDate, isoDate } from '@itrms/ethiopian-calendar';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';
import { Public } from '@itrms/kernel/iam';
import type { I18nText } from '@itrms/schemas';

import { VERIFICATION_TOKEN, type VerificationOut } from '../contracts';
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

@Public()
@Controller('api/v1/public')
export class VerificationController {
    constructor(@Inject(DATABASE) private readonly db: Database) {}

    @Get('verifications/:token')
    @Header('Cache-Control', 'no-store')
    verify(@Param('token') token: string): Promise<VerificationOut> {
        if (!VERIFICATION_TOKEN.test(token)) throw new NotFoundError();
        return this.db.scoped({}, async (tx) => {
            const { rows } = await tx.execute<Row>(sql`select * from documents.verification(${tokenHash(token)})`);
            const row = rows[0];
            if (!row) throw new NotFoundError();
            return {
                status: statusOf(row, isoDate(addisDate(new Date()))),
                documentName: row.document_name,
                number: row.number,
                office: row.office,
                issuedOn: row.issued_on,
                validUntil: row.valid_until,
                holder: row.holder
            };
        });
    }
}
