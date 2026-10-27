/**
 * A person's own notifications (task 0.20a): the newest first, a page at a time, and marking them read. Only through the
 * reviewed `kernel.my_notifications` and `kernel.read_my_notifications` (the API holds no grant on the table); the text
 * is the message in every language the installation has, with its values.
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import type { Database } from '../db/database';
import { DATABASE } from '../observability/tokens';
import { requestDbContext, SignedIn } from '../iam/access';
import { textOf } from '../iam/menu';
import { SHELL, type Shell } from '../iam/shell';

class ListDto extends createZodDto(
    z.strictObject({
        before: z.iso.datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50)
    })
) {}

class ReadDto extends createZodDto(z.strictObject({ ids: z.array(z.uuid()).min(1).max(200) })) {}

interface Row extends Record<string, unknown> {
    id: string;
    unit_id: string;
    message_key: string;
    params: Record<string, string>;
    link: Record<string, string> | null;
    read_at: Date | string | null;
    created_at: Date | string;
}

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

@Controller('api/v1/me/notifications')
export class NotificationsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(SHELL) private readonly shell: Shell
    ) {}

    @Get()
    @SignedIn()
    list(@Query() query: ListDto) {
        return this.db.scoped(requestDbContext(), async (tx) => {
            const rows = await tx.execute<Row>(
                sql`select * from kernel.my_notifications(${query.limit}::int, ${query.before ?? null}::timestamptz)`
            );
            return {
                items: rows.rows.map((r) => {
                    const text = Object.fromEntries(
                        Object.entries(textOf(this.shell.messages, r.message_key)).map(([language, template]) => [
                            language,
                            Object.entries(r.params).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), template)
                        ])
                    );
                    return {
                        id: r.id,
                        unitId: r.unit_id,
                        key: r.message_key,
                        text,
                        link: r.link,
                        read: r.read_at !== null,
                        at: iso(r.created_at)
                    };
                })
            };
        });
    }

    @Post('read')
    @HttpCode(200)
    @SignedIn()
    read(@Body() body: ReadDto) {
        return this.db.scoped(requestDbContext(), async (tx) => {
            const result = await tx.execute<{ n: number }>(
                sql`select kernel.read_my_notifications(${`{${body.ids.join(',')}}`}::uuid[]) as n`
            );
            return { marked: result.rows[0]?.n ?? 0 };
        });
    }
}
