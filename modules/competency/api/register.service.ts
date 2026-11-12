/**
 * The training schools' lists and the print batches (task 0.24a): what a licence relies on and where it goes after. A person's
 * training is entered by the office that handles them, from the school's list; a batch goes to the printer once, through the worker.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { StationeryStock } from '@itrms/fees/api';
import { parseStationeryKey } from '@itrms/fees/contracts';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { emit } from '@itrms/kernel/outbox';
import { organisations, persons } from '@itrms/parties/api';

import {
    enrolmentSchema,
    printBatchPrintedSchema,
    printBatchSchema,
    type ENROLMENT_STATUSES,
    type Enrolment,
    type PrintBatchPrinted
} from '../contracts';
import { licenceGradeTypes, licencePrintBatches, licencePrintBatchItems, trainingEnrolments } from './competency.table';
import type { EnrolmentCreate } from './licences.service';

/** A person acting always has a region and a unit: the guards saw to that. */
function required(value: string | undefined): string {
    if (!value) throw new Error('no active unit in the request context');
    return value;
}

@Injectable()
export class RegisterService {
    constructor(@Inject(StationeryStock) private readonly stationery: StationeryStock) {}

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

    /**
     * A sent batch came back printed (task 1.12a): each of its licences on the card blank named, and each blank spoiled in
     * the printing recorded with why. Every blank comes from the acting office's controlled stationery (it printed them)
     * and is used once; the batch is then returned. All or nothing: a blank not in the office's stock, a licence missing or
     * not of the batch refuses the whole record.
     */
    async recordPrinted(tx: Tx, ctx: DbContext, id: string, version: number, given: PrintBatchPrinted) {
        const parsed = printBatchPrintedSchema.safeParse(given);
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
            });
        const input = parsed.data;
        const [row] = await tx.select().from(licencePrintBatches).where(eq(licencePrintBatches.id, id)).for('update');
        if (!row) throw new NotFoundError();
        if (row.status !== 'sent')
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.batch_not_printable' });
        const items = await tx
            .select()
            .from(licencePrintBatchItems)
            .where(eq(licencePrintBatchItems.batchId, id))
            // the order the batch went to the printer in (handlers/national.ts): its cards follow it
            .orderBy(asc(licencePrintBatchItems.createdAt), asc(licencePrintBatchItems.id));
        const byLicence = new Map(items.map((i) => [i.licenceId, i]));
        const cards = input.cards ?? this.cardsFrom(input.firstCardKey ?? '', items, input.spoiled ?? []);
        const named = new Set(cards.map((c) => c.licenceId));
        const strangers = cards.filter((c) => !byLicence.has(c.licenceId));
        const forgotten = items.filter((i) => !named.has(i.licenceId));
        if (strangers.length > 0 || forgotten.length > 0)
            throw new ValidationError('validation_failed', {
                errors: [
                    ...strangers.map((c) => ({
                        path: `cards.${cards.indexOf(c)}.licenceId`,
                        code: 'not_in_batch',
                        message: 'is not a licence of this batch'
                    })),
                    ...(forgotten.length
                        ? [
                              {
                                  path: 'cards',
                                  code: 'licence_missing',
                                  message: `${forgotten.length} licence(s) of the batch have no card`
                              }
                          ]
                        : [])
                ]
            });
        const serials = [...cards.map((c) => c.cardKey), ...(input.spoiled ?? []).map((s) => s.cardKey)];
        const seen = new Set<string>();
        serials.forEach((key, i) => {
            const p = parseStationeryKey(key);
            if (!p)
                throw new ValidationError('validation_failed', {
                    errors: [
                        {
                            path: i < cards.length ? `cards.${i}.cardKey` : 'spoiled',
                            code: 'invalid_serial',
                            message: 'is not a serial'
                        }
                    ]
                });
            const idOf = `${p.series}/${p.serial}`;
            if (seen.has(idOf))
                throw new ValidationError('validation_failed', {
                    errors: [{ path: 'cards', code: 'card_twice', message: `card ${p.key} is named twice` }]
                });
            seen.add(idOf);
        });
        await this.stationery.lockKeys(tx, ctx, 'licence_blank', serials);
        for (const card of cards) {
            const item = byLicence.get(card.licenceId);
            if (!item) continue;
            const blank = await this.stationery.use(tx, ctx, {
                kind: 'licence_blank',
                key: card.cardKey,
                usedFor: { table: 'competency.licence_print_batch_items', id: item.id }
            });
            await updateAudited(tx, licencePrintBatchItems, item.id, item.rowVersion, {
                cardKey: blank.itemKey,
                stationeryItemId: blank.id
            });
        }
        for (const spoiled of input.spoiled ?? [])
            await this.stationery.spoil(tx, ctx, {
                kind: 'licence_blank',
                key: spoiled.cardKey,
                reason: spoiled.reason
            });
        const updated = await updateAudited(tx, licencePrintBatches, id, version, { status: 'returned' });
        return this.batchView(updated, items.length);
    }

    /** The batch's licences, in the order they joined it, on consecutive blanks from the first one, the spoiled skipped. */
    private cardsFrom(
        first: string,
        items: readonly { licenceId: string }[],
        spoiled: readonly { cardKey: string }[]
    ): { licenceId: string; cardKey: string }[] {
        const start = parseStationeryKey(first);
        if (!start)
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'firstCardKey', code: 'invalid_serial', message: 'is not a serial' }]
            });
        const width = start.key.length - start.series.length;
        const skip = new Set(
            spoiled.map((s) => parseStationeryKey(s.cardKey)).flatMap((p) => (p ? [`${p.series}/${p.serial}`] : []))
        );
        const out: { licenceId: string; cardKey: string }[] = [];
        let serial = start.serial;
        for (const item of items) {
            while (skip.has(`${start.series}/${serial}`)) serial += 1;
            out.push({ licenceId: item.licenceId, cardKey: `${start.series}${String(serial).padStart(width, '0')}` });
            serial += 1;
        }
        return out;
    }
}
