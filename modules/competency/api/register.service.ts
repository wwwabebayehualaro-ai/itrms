/**
 * The training schools' lists and the print batches (task 0.24a): what a licence relies on and where it goes after. A person's
 * training is entered by the office that handles them, from the school's list; a batch goes to the printer once, through the worker.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError } from '@itrms/kernel/errors';
import { emit } from '@itrms/kernel/outbox';
import { organisations, persons } from '@itrms/parties/api';

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
    /** Enrolments with who and what they are about, as the register has them now. */
    private async enrolmentViews(tx: Tx, where: SQL | undefined, limit: number): Promise<Enrolment[]> {
        const rows = await tx
            .select({
                enrolment: trainingEnrolments,
                grade: licenceGradeTypes.key,
                gradeName: licenceGradeTypes.name,
                schoolName: organisations.name,
                person: persons
            })
            .from(trainingEnrolments)
            .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, trainingEnrolments.gradeTypeId))
            .innerJoin(organisations, eq(organisations.id, trainingEnrolments.schoolId))
            .innerJoin(persons, eq(persons.id, trainingEnrolments.personId))
            .where(where)
            .orderBy(desc(trainingEnrolments.createdAt))
            .limit(limit);
        const nameOf = (...parts: (string | null)[]) => parts.filter(Boolean).join(' ');
        return rows.map((r) =>
            enrolmentSchema.parse({
                id: r.enrolment.id,
                personId: r.enrolment.personId,
                schoolId: r.enrolment.schoolId,
                grade: r.grade,
                personName: {
                    am: nameOf(r.person.givenNameAm, r.person.fatherNameAm, r.person.grandfatherNameAm),
                    en: r.person.givenNameEn
                        ? nameOf(r.person.givenNameEn, r.person.fatherNameEn, r.person.grandfatherNameEn)
                        : null
                },
                schoolName: r.schoolName,
                gradeName: r.gradeName,
                status: r.enrolment.status,
                completedOn: r.enrolment.completedOn,
                version: r.enrolment.rowVersion
            })
        );
    }

    private async enrolment(tx: Tx, id: string): Promise<Enrolment> {
        const [view] = await this.enrolmentViews(tx, eq(trainingEnrolments.id, id), 1);
        if (!view) throw new NotFoundError();
        return view;
    }

    async enrol(tx: Tx, ctx: DbContext, input: EnrolmentCreate): Promise<Enrolment> {
        const regionId = required(ctx.regionId);
        const [school] = await tx
            .select({ kind: organisations.kind })
            .from(organisations)
            .where(eq(organisations.id, input.schoolId));
        if (school?.kind !== 'training_school')
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.not_training_school' });
        const [grade] = await tx
            .select({ id: licenceGradeTypes.id })
            .from(licenceGradeTypes)
            .where(and(eq(licenceGradeTypes.regionId, regionId), eq(licenceGradeTypes.key, input.grade)));
        if (!grade)
            throw new ConflictError('not_configured', {
                detailKey: 'competency.errors.no_such_grade',
                params: { grade: String(input.grade) }
            });
        const made = await insertAudited(tx, trainingEnrolments, {
            regionId,
            handlingUnitId: required(ctx.unitId),
            personId: input.personId,
            schoolId: input.schoolId,
            gradeTypeId: grade.id
        });
        return this.enrolment(tx, made.id);
    }

    async complete(tx: Tx, id: string, version: number, completedOn: string): Promise<Enrolment> {
        const [row] = await tx
            .select({ id: trainingEnrolments.id })
            .from(trainingEnrolments)
            .where(eq(trainingEnrolments.id, id));
        if (!row) throw new NotFoundError();
        await updateAudited(tx, trainingEnrolments, id, version, { status: 'completed', completedOn });
        return this.enrolment(tx, id);
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
        return { items: await this.enrolmentViews(tx, where.length ? and(...where) : undefined, query.limit) };
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
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.batch_not_sendable' });
        const updated = await updateAudited(tx, licencePrintBatches, id, version, { status: 'requested' });
        await emit(tx, 'licence-batch.print-requested.v1', { batchId: id });
        return this.batchView(updated, items.length);
    }
}
