/**
 * The administrators' view of the background work (architecture.md §12): the events in their scope that failed for good
 * (dead letters), with their error, and sending one back to the queue. RLS keeps a unit's administrator to their subtree.
 */
import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../db/database';
import { NotFoundError, InvalidRequestError } from '../errors';
import { Require, requestDbContext } from '../iam/access';
import { DATABASE } from '../observability/tokens';
import { OUTBOX_STATUSES, outboxEvents, type OutboxStatus } from './outbox.table';

@Controller('api/v1/admin/jobs')
export class JobsController {
    constructor(@Inject(DATABASE) private readonly db: Database) {}

    /** The events in the caller's scope with a status (`dead` by default), newest first. */
    @Get()
    @Require('job:read')
    list(@Query('status') status = 'dead') {
        if (!(OUTBOX_STATUSES as readonly string[]).includes(status))
            throw new InvalidRequestError('invalid_query', {
                detail: `status is one of ${OUTBOX_STATUSES.join(', ')}`
            });
        return this.db.scoped(requestDbContext(), (tx) =>
            tx
                .select({
                    id: outboxEvents.id,
                    type: outboxEvents.type,
                    unitId: outboxEvents.unitId,
                    status: outboxEvents.status,
                    attempts: outboxEvents.attempts,
                    lastError: outboxEvents.lastError,
                    createdAt: outboxEvents.createdAt
                })
                .from(outboxEvents)
                .where(eq(outboxEvents.status, status as OutboxStatus))
                .orderBy(desc(outboxEvents.createdAt))
                .limit(200)
        );
    }

    /** Sends a dead event back: the relay enqueues it again, with its attempts counted from zero. */
    @Post(':id/retries')
    @HttpCode(202)
    @Require('job:retry')
    retry(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), async (tx) => {
            const [event] = await tx
                .update(outboxEvents)
                // the database's clock (the hosts' clocks differ)
                .set({ status: 'pending', attempts: 0, lastError: null, availableAt: sql`now()` })
                .where(and(eq(outboxEvents.id, id), inArray(outboxEvents.status, ['dead'])))
                .returning({ id: outboxEvents.id, status: outboxEvents.status });
            if (!event) throw new NotFoundError();
            return event;
        });
    }
}
