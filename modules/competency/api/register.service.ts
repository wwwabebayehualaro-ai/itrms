/**
 * The training schools' lists and the print batches (task 0.24a): what a licence relies on and where it goes after. A person's
 * training is entered by the office that handles them, from the school's list; a batch goes to the printer once, through the worker.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError } from '@itrms/kernel/errors';
import { emit } from '@itrms/kernel/outbox';
import { organisations } from '@itrms/parties/api';

import { enrolmentSchema, printBatchSchema, type ENROLMENT_STATUSES, type Enrolment } from '../contracts';
import { licenceGradeTypes, licencePrintBatches, licencePrintBatchItems, trainingEnrolments } from './competency.table';
import type { EnrolmentCreate } from './licences.service';

/** A person acting always has a region and a unit: the guards saw to that. */
function required(value: string | undefined): string {
    if (!value) throw new Error('no active unit in the request context');
    return value;
}

@Injectable()
export class RegisterService {
    private enrolmentView(row: typeof trainingEnrolments.$inferSelect, grade: string): Enrolment {
        return enrolmentSchema.parse({
            id: row.id,
            personId: row.personId,
            schoolId: row.schoolId,
            grade,
            status: row.status,
            completedOn: row.completedOn,
            version: row.rowVersion
        });
    }

    async enrol(tx: Tx, ctx: DbContext, input: EnrolmentCreate): Promise<Enrolment> {
        const regionId = required(ctx.regionId);
        const [school] = await tx
            .select({ kind: organisations.kind })
            .from(organisations)
            .where(eq(organisations.id, input.schoolId));
        if (school?.kind !== 'training_school')
            throw new ConflictError('invalid_transition', { detail: 'This organisation is not a training school.' });
        const [grade] = await tx
            .select({ id: licenceGradeTypes.id, key: licenceGradeTypes.key })
            .from(licenceGradeTypes)
            .where(and(eq(licenceGradeTypes.regionId, regionId), eq(licenceGradeTypes.key, input.grade)));
        if (!grade) throw new ConflictError('not_configured', { detail: `No licence grade ${input.grade}.` });
        const made = await insertAudited(tx, trainingEnrolments, {
            regionId,
            handlingUnitId: required(ctx.unitId),
            personId: input.personId,
            schoolId: input.schoolId,
            gradeTypeId: grade.id
        });
        return this.enrolmentView(made, grade.key);
    }

    async complete(tx: Tx, id: string, version: number, completedOn: string): Promise<Enrolment> {
        const [row] = await tx
            .select({ enrolment: trainingEnrolments, grade: licenceGradeTypes.key })
            .from(trainingEnrolments)
            .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, trainingEnrolments.gradeTypeId))
            .where(eq(trainingEnrolments.id, id));
        if (!row) throw new NotFoundError();
        const updated = await updateAudited(tx, trainingEnrolments, id, version, {
            status: 'completed',
            completedOn
        });
        return this.enrolmentView(updated, row.grade);
    }

    async enrolments(
        tx: Tx,
        query: {
            personId?: string;
            schoolId?: string;
            status?: (typeof ENROLMENT_STATUSES)[number];
            limit: number;
        }
    ) {
        const where: SQL[] = [];
        if (query.personId) where.push(eq(trainingEnrolments.personId, query.personId));
        if (query.schoolId) where.push(eq(trainingEnrolments.schoolId, query.schoolId));
        if (query.status) where.push(eq(trainingEnrolments.status, query.status));
        const rows = await tx
            .select({ enrolment: trainingEnrolments, grade: licenceGradeTypes.key })
            .from(trainingEnrolments)
            .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, trainingEnrolments.gradeTypeId))
            .where(where.length ? and(...where) : undefined)
            .orderBy(desc(trainingEnrolments.createdAt))
            .limit(query.limit);
        return { items: rows.map((r) => this.enrolmentView(r.enrolment, r.grade)) };
    }

    private batchView(row: typeof licencePrintBatches.$inferSelect, licences: number) {
        return printBatchSchema.parse({
            id: row.id,
            status: row.status,
            handlingUnitId: row.handlingUnitId,
            nationalReference: row.nationalReference,
            licences,
            createdAt: row.createdAt.toISOString(),
            version: row.rowVersion
        });
    }

    async batches(tx: Tx, limit = 50) {
        const rows = await tx
            .select({
                batch: licencePrintBatches,
                // spelled out: a select from one table prints its columns without the table, and `id` here would be the item's
                licences: sql<number>`(select count(*)::int from competency.licence_print_batch_items i
                                        where i.batch_id = competency.licence_print_batches.id)`
            })
            .from(licencePrintBatches)
            .orderBy(desc(licencePrintBatches.createdAt))
            .limit(limit);
        return { items: rows.map((r) => this.batchView(r.batch, r.licences)) };
    }

    /** It goes to the printer through the worker; asked twice it goes once. An empty batch has nothing to send. */
    async send(tx: Tx, id: string, version: number) {
        const [row] = await tx.select().from(licencePrintBatches).where(eq(licencePrintBatches.id, id)).for('update');
        if (!row) throw new NotFoundError();
        const items = await tx
            .select({ id: licencePrintBatchItems.id })
            .from(licencePrintBatchItems)
            .where(eq(licencePrintBatchItems.batchId, id));
        if (row.status !== 'open' || items.length === 0)
            throw new ConflictError('invalid_transition', { detail: 'Only an open batch with licences can be sent.' });
        const updated = await updateAudited(tx, licencePrintBatches, id, version, { status: 'requested' });
        await emit(tx, 'licence-batch.print-requested.v1', { batchId: id });
        return this.batchView(updated, items.length);
    }
}
