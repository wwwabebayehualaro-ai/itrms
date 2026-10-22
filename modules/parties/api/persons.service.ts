/**
 * The register of persons (task 0.14): create, read, correct, search, the duplicate check and reveal. Every write goes
 * through the audited helpers in the caller's transaction; the sensitive fields are encrypted before they reach a table
 * and read back only through reveal().
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { DATABASE } from '@itrms/kernel/api';
import { FIELD_CRYPTO, reveal, type FieldCrypto } from '@itrms/kernel/crypto';
import { insertAudited, newId, updateAudited, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { foldForSearch } from '@itrms/schemas';
import type { z } from 'zod';

import type {
    DuplicateList,
    Person,
    PersonCreate,
    PersonName,
    PersonSummary,
    PersonUpdate,
    SensitiveField,
    duplicateCheckSchema,
    revealedSchema
} from '../contracts';
import { persons, personSensitive } from './parties.table';
import { isUniqueViolation, required, unitRefs, withinScope, type UnitRef } from './support';

type PersonRow = typeof persons.$inferSelect;
type SensitiveRow = typeof personSensitive.$inferSelect;
type SensitiveInput = NonNullable<PersonCreate['sensitive']>;

const COLUMN: Record<
    SensitiveField,
    { ct: 'birthDateCt' | 'phoneCt' | 'finCt'; bidx: 'birthDateBidx' | 'phoneBidx' | 'finBidx'; column: string }
> = {
    birthDate: { ct: 'birthDateCt', bidx: 'birthDateBidx', column: 'birth_date' },
    phone: { ct: 'phoneCt', bidx: 'phoneBidx', column: 'phone' },
    fin: { ct: 'finCt', bidx: 'finBidx', column: 'fin' }
};
const FIELDS = Object.keys(COLUMN) as SensitiveField[];

/** Where a value is encrypted: bound to its column and its row. */
const place = (field: SensitiveField, personId: string) =>
    `parties.person_sensitive.${COLUMN[field].column}:${personId}`;

const words = (name?: Partial<PersonName> | null) =>
    name ? [name.given, name.father, name.grandfather].filter((w): w is string => Boolean(w)) : [];

/** Both scripts' names folded: what the trigram search matches. */
export const searchTextOf = (nameAm: PersonName, nameEn?: PersonName | null) =>
    foldForSearch([...words(nameAm), ...words(nameEn)].join(' '));

/** Given and father name folded: the duplicate check's exact name. */
export const nameKeyOf = (name: PersonName) => foldForSearch(`${name.given} ${name.father}`);

const nameOf = (given: string | null, father: string | null, grandfather: string | null): PersonName | null =>
    given && father ? { given, father, ...(grandfather ? { grandfather } : {}) } : null;

function summaryOf(row: PersonRow, units: ReadonlyMap<string, UnitRef>): PersonSummary {
    return {
        id: row.id,
        nameAm: nameOf(row.givenNameAm, row.fatherNameAm, row.grandfatherNameAm) as PersonName,
        nameEn: nameOf(row.givenNameEn, row.fatherNameEn, row.grandfatherNameEn),
        sex: row.sex,
        birthYear: row.birthYear,
        handlingUnit: units.get(row.handlingUnitId) ?? { id: row.handlingUnitId, code: '', name: {} },
        status: row.status
    };
}

@Injectable()
export class PersonsService {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto
    ) {}

    // ---- reads ----

    async get(tx: Tx, id: string): Promise<Person> {
        const [row] = await tx.select().from(persons).where(eq(persons.id, id));
        if (!row) throw new NotFoundError();
        const [sensitive] = await tx
            .select({
                birthDate: personSensitive.birthDateBidx,
                phone: personSensitive.phoneBidx,
                fin: personSensitive.finBidx
            })
            .from(personSensitive)
            .where(eq(personSensitive.personId, id));
        const units = await unitRefs(tx, [row.handlingUnitId, row.addressUnitId]);
        return {
            ...summaryOf(row, units),
            version: row.rowVersion,
            address: row.addressUnitId
                ? {
                      unit: units.get(row.addressUnitId) ?? { id: row.addressUnitId, code: '', name: {} },
                      kebele: row.kebele,
                      houseNumber: row.houseNumber
                  }
                : null,
            mergedIntoId: row.mergedIntoId,
            sensitive: {
                birthDate: Boolean(sensitive?.birthDate),
                phone: Boolean(sensitive?.phone),
                fin: Boolean(sensitive?.fin)
            },
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString()
        };
    }

    /** Summaries of these persons in this order (read under RLS: only the caller's region). */
    async summaries(tx: Tx, ids: readonly string[]): Promise<PersonSummary[]> {
        if (ids.length === 0) return [];
        const rows = await tx
            .select()
            .from(persons)
            .where(inArray(persons.id, [...ids]));
        const units = await unitRefs(
            tx,
            rows.map((r) => r.handlingUnitId)
        );
        const byId = new Map(rows.map((r) => [r.id, summaryOf(r, units)]));
        return ids.flatMap((id) => byId.get(id) ?? []);
    }

    /** A name in either script, folded: the region's persons whose names hold every word, the most similar first. */
    async search(tx: Tx, q: string, limit: number): Promise<PersonSummary[]> {
        const result = await tx.execute<{ person_id: string }>(
            sql`select person_id from parties.search_persons(${foldForSearch(q)}, null, null, ${limit})`
        );
        return this.summaries(
            tx,
            result.rows.map((r) => r.person_id)
        );
    }

    /** The persons with this exact FIN or phone (by blind index). */
    async lookup(tx: Tx, regionId: string, by: { fin?: string; phone?: string }): Promise<PersonSummary[]> {
        const fin = by.fin === undefined ? null : this.crypto.blindIndex(regionId, 'fin', by.fin);
        const phone = by.phone === undefined || fin ? null : this.crypto.blindIndex(regionId, 'phone', by.phone);
        const result = await tx.execute<{ person_id: string }>(
            sql`select person_id from parties.search_persons(null, ${fin}, ${phone}, 50)`
        );
        return this.summaries(
            tx,
            result.rows.map((r) => r.person_id)
        );
    }

    /**
     * Who a new record may be the same person as: the same FIN (never two living records), or the same name with the same
     * birth date and/or phone. A name alone is not enough: many people share one.
     */
    async duplicates(tx: Tx, regionId: string, input: z.infer<typeof duplicateCheckSchema>): Promise<DuplicateList> {
        const reasons = new Map<string, Set<DuplicateList['items'][number]['reasons'][number]>>();
        const add = (id: string, reason: DuplicateList['items'][number]['reasons'][number]) =>
            reasons.set(id, (reasons.get(id) ?? new Set()).add(reason));
        const { fin, phone, birthDate } = input.sensitive ?? {};
        if (fin) for (const p of await this.lookup(tx, regionId, { fin })) if (p.status === 'active') add(p.id, 'fin');

        const phoneIdx = phone ? this.crypto.blindIndex(regionId, 'phone', phone) : undefined;
        const birthIdx = birthDate ? this.crypto.blindIndex(regionId, 'birth_date', birthDate) : undefined;
        if (phoneIdx || birthIdx) {
            const keys = [eq(persons.nameKeyAm, nameKeyOf(input.nameAm))];
            if (input.nameEn) keys.push(eq(persons.nameKeyEn, nameKeyOf(input.nameEn)));
            const candidates = await tx
                .select({ id: persons.id, phone: personSensitive.phoneBidx, birthDate: personSensitive.birthDateBidx })
                .from(persons)
                .innerJoin(personSensitive, eq(personSensitive.personId, persons.id))
                .where(and(eq(persons.regionId, regionId), eq(persons.status, 'active'), or(...keys)))
                .limit(50);
            for (const c of candidates) {
                const samePhone = Boolean(phoneIdx && c.phone?.equals(phoneIdx));
                const sameBirth = Boolean(birthIdx && c.birthDate?.equals(birthIdx));
                if (samePhone && sameBirth) add(c.id, 'name_birth_date_phone');
                else if (samePhone) add(c.id, 'name_phone');
                else if (sameBirth) add(c.id, 'name_birth_date');
            }
        }
        const found = await this.summaries(tx, [...reasons.keys()]);
        return { items: found.map((person) => ({ person, reasons: [...(reasons.get(person.id) ?? [])] })) };
    }

    /**
     * A lookup by an exact FIN or phone, recorded first as a sensitive event (who looked, by which kind of value; never
     * the value): finding who holds a number tells something about them, as a reveal does.
     */
    async lookupRecorded(ctx: DbContext, by: { fin?: string; phone?: string }): Promise<PersonSummary[]> {
        const regionId = required(ctx.regionId);
        await this.db.recordSensitiveEvent(ctx, {
            type: 'person.looked_up',
            table: personSensitive,
            data: { by: by.fin === undefined ? 'phone' : 'fin' }
        });
        return this.db.scoped(ctx, (tx) => this.lookup(tx, regionId, by));
    }

    /** The duplicate check, recorded first as a sensitive event: it can confirm a birth date or phone of a name. */
    async duplicatesRecorded(ctx: DbContext, input: z.infer<typeof duplicateCheckSchema>): Promise<DuplicateList> {
        const regionId = required(ctx.regionId);
        await this.db.recordSensitiveEvent(ctx, {
            type: 'person.duplicates_checked',
            table: personSensitive,
            data: { fields: Object.keys(input.sensitive ?? {}).sort() }
        });
        return this.db.scoped(ctx, (tx) => this.duplicates(tx, regionId, input));
    }

    // ---- writes ----

    async create(tx: Tx, ctx: DbContext, input: PersonCreate): Promise<Person> {
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        const birthYear = this.birthYear(input.birthYear, input.sensitive?.birthDate);
        await this.checkAddress(tx, input.address?.unitId);

        const duplicates = await this.duplicates(tx, regionId, input);
        const sameFin = duplicates.items.filter((d) => d.reasons.includes('fin'));
        if (sameFin.length)
            throw new ConflictError('duplicate_reference', {
                detail: 'A person with this Fayda number is registered.'
            });
        const acknowledged = new Set(input.acknowledgedDuplicates ?? []);
        const unseen = duplicates.items.filter((d) => !acknowledged.has(d.person.id));
        if (unseen.length)
            throw new ValidationError('validation_failed', {
                detail: 'This may be a person already registered: check the possible duplicates first.',
                errors: unseen.map((d) => ({
                    path: 'acknowledgedDuplicates',
                    code: 'possible_duplicate',
                    message: d.person.id
                }))
            });

        const id = newId();
        await insertAudited(tx, persons, {
            id,
            regionId,
            handlingUnitId: unitId,
            ...this.nameColumns(input.nameAm, input.nameEn),
            sex: input.sex,
            birthYear,
            addressUnitId: input.address?.unitId ?? null,
            kebele: input.address?.kebele ?? null,
            houseNumber: input.address?.houseNumber ?? null
        });
        const sensitive = await this.sensitiveColumns(tx, regionId, id, input.sensitive ?? {});
        if (Object.keys(sensitive).length)
            await this.guardFin(() =>
                insertAudited(tx, personSensitive, { id, personId: id, regionId, handlingUnitId: unitId, ...sensitive })
            );
        return this.get(tx, id);
    }

    async update(tx: Tx, ctx: DbContext, id: string, version: number, input: PersonUpdate): Promise<Person> {
        const regionId = required(ctx.regionId);
        const current = await this.writable(tx, ctx, id);
        if (input.address) await this.checkAddress(tx, input.address.unitId);
        const nameAm =
            input.nameAm ??
            (nameOf(current.givenNameAm, current.fatherNameAm, current.grandfatherNameAm) as PersonName);
        const nameEn =
            input.nameEn === undefined
                ? nameOf(current.givenNameEn, current.fatherNameEn, current.grandfatherNameEn)
                : input.nameEn;
        const changes: Partial<typeof persons.$inferInsert> = {};
        if (input.nameAm !== undefined || input.nameEn !== undefined)
            Object.assign(changes, this.nameColumns(nameAm, nameEn));
        if (input.sex !== undefined) changes.sex = input.sex;
        const birthDate = input.sensitive?.birthDate;
        if (birthDate) changes.birthYear = this.birthYear(input.birthYear ?? undefined, birthDate);
        else if (input.birthYear !== undefined) {
            // a year of its own only when no birth date is on record (or it is removed now): the two never disagree
            const [recorded] = await tx
                .select({ birthDate: personSensitive.birthDateBidx })
                .from(personSensitive)
                .where(eq(personSensitive.personId, id));
            if (recorded?.birthDate && birthDate !== null)
                throw new ValidationError('validation_failed', {
                    errors: [{ path: 'birthYear', code: 'custom', message: 'follows the birth date on record' }]
                });
            changes.birthYear = input.birthYear;
        }
        if (input.address !== undefined) {
            changes.addressUnitId = input.address?.unitId ?? null;
            changes.kebele = input.address?.kebele ?? null;
            changes.houseNumber = input.address?.houseNumber ?? null;
        }
        // the record's own version, even when only its sensitive fields change: a correction is one change
        await updateAudited(tx, persons, id, version, changes);

        if (input.sensitive && Object.keys(input.sensitive).length) {
            if (input.sensitive.fin) {
                const others = (await this.lookup(tx, regionId, { fin: input.sensitive.fin })).filter(
                    (p) => p.id !== id && p.status === 'active'
                );
                if (others.length)
                    throw new ConflictError('duplicate_reference', {
                        detail: 'A person with this Fayda number is registered.'
                    });
            }
            const columns = await this.sensitiveColumns(tx, regionId, id, input.sensitive);
            const [existing] = await tx.select().from(personSensitive).where(eq(personSensitive.personId, id));
            await this.guardFin(() =>
                existing
                    ? updateAudited(tx, personSensitive, id, existing.rowVersion, columns)
                    : insertAudited(tx, personSensitive, {
                          id,
                          personId: id,
                          regionId,
                          handlingUnitId: current.handlingUnitId,
                          ...columns
                      })
            );
        }
        return this.get(tx, id);
    }

    /**
     * The sensitive fields in clear, for a person allowed `pii:reveal`: the request (fields, reason) is recorded first, in
     * a transaction of its own, so it stays on record whatever happens next.
     */
    async reveal(
        ctx: DbContext,
        id: string,
        fields: readonly SensitiveField[],
        reason: string
    ): Promise<z.infer<typeof revealedSchema>> {
        const regionId = required(ctx.regionId);
        return reveal(
            this.db,
            ctx,
            { type: 'person.revealed', table: personSensitive, rowId: id, fields, reason },
            async (tx) => {
                const [person] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, id));
                if (!person) throw new NotFoundError();
                const [row] = await tx.select().from(personSensitive).where(eq(personSensitive.personId, id));
                const out: Record<string, string | null> = {};
                for (const field of fields) {
                    const ciphertext = row?.[COLUMN[field].ct];
                    out[field] = ciphertext
                        ? await this.crypto.decrypt(tx, regionId, place(field, id), ciphertext)
                        : null;
                }
                return out;
            }
        );
    }

    // ---- helpers ----

    /** The record, if the caller's unit handles it (its subtree): a record of another office is read-only here. */
    async writable(tx: Tx, ctx: DbContext, id: string): Promise<PersonRow> {
        const [row] = await tx.select().from(persons).where(eq(persons.id, id));
        if (!row) throw new NotFoundError();
        if (!withinScope(row.handlingOrgPath, ctx.scopePath ?? ''))
            throw new ForbiddenError({ detail: 'This record is handled by another office.' });
        if (row.status === 'merged')
            throw new ConflictError('invalid_transition', { detail: 'This record was merged into another.' });
        return row;
    }

    private nameColumns(nameAm: PersonName, nameEn?: PersonName | null) {
        return {
            givenNameAm: nameAm.given,
            fatherNameAm: nameAm.father,
            grandfatherNameAm: nameAm.grandfather ?? null,
            givenNameEn: nameEn?.given ?? null,
            fatherNameEn: nameEn?.father ?? null,
            grandfatherNameEn: nameEn?.grandfather ?? null,
            searchText: searchTextOf(nameAm, nameEn),
            nameKeyAm: nameKeyOf(nameAm),
            nameKeyEn: nameEn ? nameKeyOf(nameEn) : null
        };
    }

    /** The birth year: the birth date's when it is given (and then a different one is refused). */
    private birthYear(year: number | undefined, birthDate: string | null | undefined): number | undefined {
        if (!birthDate) return year;
        const fromDate = Number(birthDate.slice(0, 4));
        if (year !== undefined && year !== fromDate)
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'birthYear', code: 'custom', message: 'differs from the birth date' }]
            });
        return fromDate;
    }

    /** An address is a unit of the caller's region. */
    private async checkAddress(tx: Tx, unitId: string | undefined) {
        if (!unitId) return;
        if (!(await unitRefs(tx, [unitId])).has(unitId))
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'address.unitId', code: 'custom', message: 'not a unit of this region' }]
            });
    }

    /** The encrypted value and blind index of each field sent; null for a field removed. */
    private async sensitiveColumns(
        tx: Tx,
        regionId: string,
        personId: string,
        input: SensitiveInput
    ): Promise<Partial<SensitiveRow>> {
        const out: Partial<Record<keyof SensitiveRow, Buffer | null>> = {};
        for (const field of FIELDS) {
            const value = input[field];
            if (value === undefined) continue;
            const { ct, bidx } = COLUMN[field];
            out[ct] = value === null ? null : await this.crypto.encrypt(tx, regionId, place(field, personId), value);
            out[bidx] =
                value === null
                    ? null
                    : this.crypto.blindIndex(regionId, field === 'birthDate' ? 'birth_date' : field, value);
        }
        return out as Partial<SensitiveRow>;
    }

    /** Two clerks registering one FIN at the same moment: the second is told, never given a second record. */
    private async guardFin<T>(write: () => Promise<T>): Promise<T> {
        try {
            return await write();
        } catch (error) {
            if (isUniqueViolation(error, 'person_sensitive_fin_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: 'A person with this Fayda number is registered.',
                    cause: error
                });
            throw error;
        }
    }
}
