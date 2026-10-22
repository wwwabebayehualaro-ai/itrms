/**
 * Merging two records of one person (task 0.14, SEC-AC-6 maker-checker): one person asks, giving a reason; another, with
 * `person:approve-merge`, approves or rejects. On approval the duplicate is closed and points to the record that stays,
 * its memberships move there, and `person.merged.v1` tells the holders of person ids (licences, cases) to follow.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { emit } from '@itrms/kernel/outbox';
import type { z } from 'zod';

import type { mergeRequestSchema, mergeSchema } from '../contracts';
import { organisationMembers, personMerges, personSensitive, persons } from './parties.table';
import { PersonsService } from './persons.service';
import { required, withinScope } from './support';

type Merge = z.infer<typeof mergeSchema>;
type MergeRow = typeof personMerges.$inferSelect;

@Injectable()
export class MergesService {
    constructor(@Inject(PersonsService) private readonly persons: PersonsService) {}

    async request(tx: Tx, ctx: DbContext, input: z.infer<typeof mergeRequestSchema>): Promise<Merge> {
        // both records active; the caller's office handles the one that will be closed
        await this.persons.writable(tx, ctx, input.duplicateId);
        const [survivor] = await tx.select().from(persons).where(eq(persons.id, input.survivorId));
        if (!survivor) throw new NotFoundError();
        if (survivor.status !== 'active')
            throw new ConflictError('invalid_transition', { detail: 'The record to keep was itself merged.' });
        try {
            const row = await insertAudited(tx, personMerges, {
                regionId: required(ctx.regionId),
                unitId: required(ctx.unitId),
                survivorId: input.survivorId,
                duplicateId: input.duplicateId,
                reason: input.reason
            });
            return this.toMerge(tx, row);
        } catch (error) {
            for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
                if ((e as { constraint?: string }).constraint === 'person_merges_pending_uq')
                    throw new ConflictError('duplicate_reference', {
                        detail: 'A merge of this record is already waiting for approval.',
                        cause: error
                    });
            throw error;
        }
    }

    async list(tx: Tx, status: MergeRow['status']): Promise<Merge[]> {
        const rows = await tx
            .select()
            .from(personMerges)
            .where(eq(personMerges.status, status))
            .orderBy(desc(personMerges.createdAt))
            .limit(100);
        return Promise.all(rows.map((r) => this.toMerge(tx, r)));
    }

    async approve(tx: Tx, ctx: DbContext, id: string, version: number, note?: string): Promise<Merge> {
        const merge = await this.pending(tx, ctx, id);
        const duplicate = await this.persons.writable(tx, ctx, merge.duplicateId);
        const [survivor] = await tx.select().from(persons).where(eq(persons.id, merge.survivorId));
        if (survivor?.status !== 'active')
            throw new ConflictError('invalid_transition', { detail: 'The record to keep was itself merged.' });
        // the duplicate's memberships move too: each must be in organisations this office handles (checked first, so a
        // merge is never half done)
        const open = (personId: string) =>
            tx
                .select()
                .from(organisationMembers)
                .where(and(eq(organisationMembers.personId, personId), isNull(organisationMembers.until)));
        const memberships = await open(duplicate.id);
        const held = await open(survivor.id);
        if (memberships.some((m) => !withinScope(m.handlingOrgPath, ctx.scopePath ?? '')))
            throw new ConflictError('invalid_transition', {
                detail: 'The record is a member of an organisation another office handles: an office above both approves.'
            });

        await updateAudited(tx, persons, duplicate.id, duplicate.rowVersion, {
            status: 'merged',
            mergedIntoId: survivor.id
        });
        const [sensitive] = await tx.select().from(personSensitive).where(eq(personSensitive.personId, duplicate.id));
        if (sensitive) await updateAudited(tx, personSensitive, sensitive.id, sensitive.rowVersion, { merged: true });
        for (const m of memberships) {
            const survivorHolds = held.some((h) => h.organisationId === m.organisationId && h.role === m.role);
            // the role is the survivor's already: the duplicate's ends today; otherwise it moves to the survivor
            await updateAudited(
                tx,
                organisationMembers,
                m.id,
                m.rowVersion,
                survivorHolds ? { until: new Date().toISOString().slice(0, 10) } : { personId: survivor.id }
            );
        }

        const decided = await updateAudited(tx, personMerges, id, version, {
            status: 'approved',
            decidedBy: ctx.userId ?? null,
            decidedAt: new Date(),
            note: note ?? null
        });
        await emit(tx, 'person.merged.v1', { survivorId: survivor.id, duplicateId: duplicate.id, mergeId: id });
        return this.toMerge(tx, decided);
    }

    async reject(tx: Tx, ctx: DbContext, id: string, version: number, note?: string): Promise<Merge> {
        await this.pending(tx, ctx, id);
        const decided = await updateAudited(tx, personMerges, id, version, {
            status: 'rejected',
            decidedBy: ctx.userId ?? null,
            decidedAt: new Date(),
            note: note ?? null
        });
        return this.toMerge(tx, decided);
    }

    /** A request waiting for a decision, by someone other than who asked. */
    private async pending(tx: Tx, ctx: DbContext, id: string): Promise<MergeRow> {
        const [merge] = await tx.select().from(personMerges).where(eq(personMerges.id, id));
        if (!merge) throw new NotFoundError();
        if (merge.status !== 'pending')
            throw new ConflictError('invalid_transition', { detail: 'This merge was already decided.' });
        if (merge.createdBy && merge.createdBy === ctx.userId)
            throw new ForbiddenError({
                detail: 'Who asks for a merge cannot approve it: another person decides.',
                audit: { reason: 'separation_of_duties', mergeId: id }
            });
        return merge;
    }

    private async toMerge(tx: Tx, row: MergeRow): Promise<Merge> {
        const [survivor, duplicate] = await this.persons.summaries(tx, [row.survivorId, row.duplicateId]);
        if (!survivor || !duplicate) throw new NotFoundError();
        return {
            id: row.id,
            version: row.rowVersion,
            survivor,
            duplicate,
            reason: row.reason,
            status: row.status,
            requestedBy: row.createdBy,
            decidedBy: row.decidedBy,
            decidedAt: row.decidedAt?.toISOString() ?? null,
            note: row.note,
            createdAt: row.createdAt.toISOString()
        };
    }
}
