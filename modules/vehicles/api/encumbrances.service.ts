/**
 * Encumbrances on a vehicle (task 1.4a; contracts/encumbrances.ts). An office records a hold on the holder's letter (a bank,
 * a court, the revenue or customs authority, an organisation of the people register) and, when the holder writes that it
 * lets go, records the release on that letter; a second person of the office, or of an office above it, confirms. Until then
 * the hold stands and `assertClear` refuses the services it conflicts with (the effect `vehicles.checkEncumbrances:<conflict>`
 * names it in a service's workflow). The database keeps the machine (the transition trigger) and who may change a row (RLS).
 *
 * `record` and `assertClear` meet on one lock per vehicle: a hold recorded while a service is giving its result either
 * commits before it (and blocks it) or after it (and the service has already given); never both.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { downloadLinkedFile, getFile, linkFile, type ObjectStore } from '@itrms/kernel/files';
import { SettingsService } from '@itrms/kernel/settings';
import { users } from '@itrms/kernel/tables';
import { OrganisationsService } from '@itrms/parties/api';
import type { z } from 'zod';

import {
    ENCUMBRANCE_BLOCKS_SETTING,
    ENCUMBRANCE_KINDS,
    encumbranceListQuerySchema,
    encumbranceRecordSchema,
    releaseRefusalSchema,
    releaseRequestSchema,
    type Encumbrance,
    type EncumbranceKind,
    type OpenEncumbrance
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { checked, fieldError, guardUnique, required, today, unitRefs, withinScope, type UnitRef } from './support';
import { vehicleEncumbrances, vehicles } from './vehicles.table';

type Row = typeof vehicleEncumbrances.$inferSelect;
type Key = keyof typeof am;

/** The table a stored letter is linked to, and the document type it is filed under. */
export const ENCUMBRANCES_TABLE = 'vehicles.vehicle_encumbrances';
const LETTER_DOCUMENT = 'encumbrance_letter';

const DUPLICATES = { vehicle_encumbrances_letter_uq: 'vehicles.errors.duplicate_encumbrance' };
const emptyRef = (id: string): UnitRef => ({ id, code: '', name: {} });
const chunks = <T>(items: readonly T[], size = 200): T[][] =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Words in the language of the person acting: a refusal is read at the counter. */
const words = (key: Key, params: Record<string, string> = {}): string =>
    (currentContext()?.language === 'en' ? en : am)[key].replace(
        /\{(\w+)\}/g,
        (whole, name: string) => params[name] ?? whole
    );
const localized = (name: Record<string, string>): string =>
    name[currentContext()?.language === 'en' ? 'en' : 'am'] ?? name.am ?? name.en ?? '';

const isString = (value: string | null): value is string => value !== null;
const isKind = (value: string): value is EncumbranceKind => (ENCUMBRANCE_KINDS as readonly string[]).includes(value);

/** The recording office itself (a release is requested there), or it and the offices above it (a release is confirmed there). */
const guardOffice = (row: Row, ctx: DbContext, mode: 'own' | 'subtree'): void => {
    const here =
        mode === 'own' ? row.recordedUnitId === ctx.unitId : withinScope(row.recordedOrgPath, ctx.scopePath ?? '');
    if (!here) throw new ForbiddenError({ detailKey: 'vehicles.errors.encumbrance_other_office' });
};

@Injectable()
export class EncumbranceService {
    constructor(
        @Inject(OrganisationsService) private readonly organisations: OrganisationsService,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    /** A hold on a vehicle, recorded open by the acting office on the holder's letter. */
    async record(tx: Tx, ctx: DbContext, given: z.input<typeof encumbranceRecordSchema>): Promise<Encumbrance> {
        const input = checked(encumbranceRecordSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        if (input.letterDate > today())
            throw fieldError('letterDate', 'in_future', words('vehicles.errors.encumbrance_in_future'));
        await this.lockVehicle(tx, input.vehicleId);
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicleId));
        if (!vehicle) throw fieldError('vehicleId', 'not_found', words('vehicles.errors.encumbrance_vehicle_unknown'));
        if (vehicle.status !== 'active' && vehicle.status !== 'stolen')
            throw new ValidationError('validation_failed', {
                detailKey: 'vehicles.errors.encumbrance_vehicle_off_register',
                errors: [
                    {
                        path: 'vehicleId',
                        code: 'off_register',
                        message: words('vehicles.errors.encumbrance_vehicle_off_register')
                    }
                ]
            });
        const [holder] = await this.organisations.summaries(tx, [input.holderOrganisationId]);
        if (!holder)
            throw fieldError('holderOrganisationId', 'not_found', words('vehicles.errors.encumbrance_holder_unknown'));
        const [same] = await tx
            .select({ id: vehicleEncumbrances.id })
            .from(vehicleEncumbrances)
            .where(
                and(
                    eq(vehicleEncumbrances.vehicleId, input.vehicleId),
                    eq(vehicleEncumbrances.kind, input.kind),
                    eq(vehicleEncumbrances.holderOrganisationId, input.holderOrganisationId),
                    eq(vehicleEncumbrances.letterReference, input.letterReference)
                )
            );
        if (same)
            throw new ConflictError('duplicate_reference', { detailKey: 'vehicles.errors.duplicate_encumbrance' });
        if (input.letterFileId) await this.ownUpload(tx, ctx, input.letterFileId, 'letterFileId');
        const row = await guardUnique(
            () =>
                insertAudited(tx, vehicleEncumbrances, {
                    regionId,
                    vehicleId: input.vehicleId,
                    recordedUnitId: unitId,
                    kind: input.kind,
                    holderOrganisationId: input.holderOrganisationId,
                    letterReference: input.letterReference,
                    letterDate: input.letterDate,
                    amountSantim: input.amountSantim === undefined ? null : BigInt(input.amountSantim),
                    note: input.note ?? null,
                    letterFileId: input.letterFileId ?? null
                }),
            DUPLICATES
        );
        if (input.letterFileId)
            await linkFile(tx, input.letterFileId, {
                table: ENCUMBRANCES_TABLE,
                id: row.id,
                documentType: LETTER_DOCUMENT
            });
        return this.one(tx, row);
    }

    /** The recording office writes down the holder's release letter; a second person confirms it before the hold lifts. */
    async requestRelease(
        tx: Tx,
        ctx: DbContext,
        id: string,
        version: number,
        given: z.input<typeof releaseRequestSchema>
    ): Promise<Encumbrance> {
        const input = checked(releaseRequestSchema, given);
        const userId = required(ctx.userId);
        const row = await this.current(tx, id, version);
        guardOffice(row, ctx, 'own');
        if (row.status !== 'open')
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.encumbrance_not_open' });
        if (input.releaseDate > today())
            throw fieldError('releaseDate', 'in_future', words('vehicles.errors.encumbrance_in_future'));
        if (input.releaseDate < row.letterDate)
            throw fieldError(
                'releaseDate',
                'before_letter',
                words('vehicles.errors.encumbrance_release_before_letter')
            );
        if (input.releaseFileId) await this.ownUpload(tx, ctx, input.releaseFileId, 'releaseFileId');
        const updated = await updateAudited(tx, vehicleEncumbrances, id, version, {
            status: 'release_pending',
            releaseReference: input.releaseReference,
            releaseDate: input.releaseDate,
            releaseFileId: input.releaseFileId ?? null,
            releaseNote: input.note ?? null,
            releaseRequestedBy: userId,
            releaseRequestedAt: new Date(),
            releaseRefusalReason: null
        });
        if (input.releaseFileId)
            await linkFile(tx, input.releaseFileId, { table: ENCUMBRANCES_TABLE, id, documentType: LETTER_DOCUMENT });
        return this.one(tx, updated);
    }

    /** A different person of the recording office, or of an office above it, confirms the release: the hold lifts for good. */
    async confirmRelease(tx: Tx, ctx: DbContext, id: string, version: number): Promise<Encumbrance> {
        const userId = required(ctx.userId);
        const row = await this.pending(tx, ctx, id, version);
        const updated = await updateAudited(tx, vehicleEncumbrances, row.id, version, {
            status: 'released',
            releasedBy: userId,
            releasedAt: new Date()
        });
        return this.one(tx, updated);
    }

    /** The second person does not confirm (the letter does not fit the hold): it stands open again, with the reason. */
    async refuseRelease(
        tx: Tx,
        ctx: DbContext,
        id: string,
        version: number,
        given: z.input<typeof releaseRefusalSchema>
    ): Promise<Encumbrance> {
        const input = checked(releaseRefusalSchema, given);
        required(ctx.userId);
        const row = await this.pending(tx, ctx, id, version);
        const updated = await updateAudited(tx, vehicleEncumbrances, row.id, version, {
            status: 'open',
            releaseReference: null,
            releaseDate: null,
            releaseFileId: null,
            releaseNote: null,
            releaseRequestedBy: null,
            releaseRequestedAt: null,
            releaseRefusalReason: input.reason
        });
        return this.one(tx, updated);
    }

    /**
     * Holds, newest first (pending releases: oldest first). Without a vehicle: the ones recorded in the caller's subtree (the office's list); of one vehicle:
     * all of them, as the whole region reads the register.
     */
    async list(
        tx: Tx,
        given: z.input<typeof encumbranceListQuerySchema>
    ): Promise<{ items: Encumbrance[]; nextCursor: string | null }> {
        const query = checked(encumbranceListQuerySchema, given);
        // releases waiting for a second person: the oldest hold first, so none is left at the bottom; the rest, newest first
        const oldestFirst = query.status === 'release_pending';
        const conditions: (SQL | undefined)[] = [
            query.vehicleId
                ? eq(vehicleEncumbrances.vehicleId, query.vehicleId)
                : // the signed scope, never a setting the request could have set
                  sql`${vehicleEncumbrances.recordedOrgPath} <@ (select kernel.ctx_scope())`,
            query.status ? eq(vehicleEncumbrances.status, query.status) : undefined,
            query.after
                ? oldestFirst
                    ? sql`(${vehicleEncumbrances.createdAt}, ${vehicleEncumbrances.id}) > (select c.created_at, c.id from vehicles.vehicle_encumbrances c where c.id = ${query.after})`
                    : lt(vehicleEncumbrances.id, query.after)
                : undefined
        ];
        const rows = await tx
            .select()
            .from(vehicleEncumbrances)
            .where(and(...conditions))
            .orderBy(
                ...(oldestFirst
                    ? [asc(vehicleEncumbrances.createdAt), asc(vehicleEncumbrances.id)]
                    : [desc(vehicleEncumbrances.id)])
            )
            .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        return {
            items: await this.many(tx, page),
            nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null
        };
    }

    async get(tx: Tx, id: string): Promise<Encumbrance> {
        const [row] = await tx.select().from(vehicleEncumbrances).where(eq(vehicleEncumbrances.id, id));
        if (!row) throw new NotFoundError();
        return this.one(tx, row);
    }

    /** A short link to the holder's letter or release letter of a hold; the download is on record. */
    async downloadFile(
        tx: Tx,
        store: ObjectStore,
        id: string,
        fileId: string
    ): Promise<{ url: string; expiresAt: string }> {
        const [row] = await tx.select().from(vehicleEncumbrances).where(eq(vehicleEncumbrances.id, id));
        if (!row || (row.letterFileId !== fileId && row.releaseFileId !== fileId)) throw new NotFoundError();
        return downloadLinkedFile(tx, store, fileId, { table: ENCUMBRANCES_TABLE, id });
    }

    /** The holds a vehicle still carries, by vehicle (one query for a page of summaries); oldest first. */
    async openFor(tx: Tx, vehicleIds: readonly string[]): Promise<Map<string, OpenEncumbrance[]>> {
        const out = new Map<string, OpenEncumbrance[]>();
        const wanted = [...new Set(vehicleIds)];
        if (wanted.length === 0) return out;
        const rows = await tx
            .select()
            .from(vehicleEncumbrances)
            .where(
                and(inArray(vehicleEncumbrances.vehicleId, wanted), sql`${vehicleEncumbrances.status} <> 'released'`)
            )
            .orderBy(asc(vehicleEncumbrances.letterDate), asc(vehicleEncumbrances.id));
        const holders = await this.holders(tx, rows);
        const units = await this.units(
            tx,
            rows.map((r) => r.recordedUnitId)
        );
        for (const r of rows)
            out.set(r.vehicleId, [
                ...(out.get(r.vehicleId) ?? []),
                {
                    id: r.id,
                    kind: r.kind,
                    status: r.status,
                    holder: { id: r.holderOrganisationId, name: holders.get(r.holderOrganisationId) ?? {} },
                    letterDate: r.letterDate,
                    recordedUnit: units.get(r.recordedUnitId) ?? emptyRef(r.recordedUnitId)
                }
            ]);
        return out;
    }

    /**
     * Refuses a service that conflicts with a hold the vehicle still carries (open, or its release not yet confirmed), naming the
     * oldest one and its holder in the acting person's language. The kinds that block each conflict are a setting (per
     * installation or region); a conflict the setting does not know is a configuration error, never a silent pass.
     */
    async assertClear(tx: Tx, vehicleId: string, conflict: string, handlingUnitId: string): Promise<void> {
        const blocks = await this.settings.value<Record<string, readonly string[]>>(
            tx,
            handlingUnitId,
            ENCUMBRANCE_BLOCKS_SETTING
        );
        const kinds = (Object.hasOwn(blocks, conflict) ? blocks[conflict] : undefined)?.filter(isKind);
        if (!kinds)
            throw new ConflictError('not_configured', {
                detailKey: 'vehicles.errors.encumbrance_conflict_unknown',
                params: { conflict }
            });
        if (kinds.length === 0) return;
        // shared with other checks, exclusive against a hold being recorded: the check never reads past a hold in flight
        await tx.execute(sql`select pg_advisory_xact_lock_shared(${this.lockKey(vehicleId)})`);
        const held = await tx
            .select()
            .from(vehicleEncumbrances)
            .where(
                and(
                    eq(vehicleEncumbrances.vehicleId, vehicleId),
                    sql`${vehicleEncumbrances.status} <> 'released'`,
                    inArray(vehicleEncumbrances.kind, kinds)
                )
            )
            .orderBy(
                asc(vehicleEncumbrances.letterDate),
                asc(vehicleEncumbrances.createdAt),
                asc(vehicleEncumbrances.id)
            );
        const [oldest] = held;
        if (!oldest) return;
        const holders = await this.holders(tx, [oldest]);
        const units = await this.units(tx, [oldest.recordedUnitId]);
        const params = {
            kind: words(`vehicles.encumbrance.kind.${oldest.kind}`),
            holder: localized(holders.get(oldest.holderOrganisationId) ?? {}),
            reference: oldest.letterReference,
            office: localized((units.get(oldest.recordedUnitId) ?? emptyRef(oldest.recordedUnitId)).name),
            more: held.length > 1 ? words('vehicles.encumbrance.more', { count: String(held.length - 1) }) : ''
        };
        throw new ValidationError('not_eligible', {
            detailKey: 'vehicles.errors.encumbered',
            params,
            errors: [{ path: 'vehicle', code: 'encumbered', message: words('vehicles.errors.encumbered', params) }]
        });
    }

    // ---- the parts the commands share

    private lockKey(vehicleId: string): SQL {
        return sql`hashtextextended(${`vehicles.encumbrance:${vehicleId}`}, 0)`;
    }

    private async lockVehicle(tx: Tx, vehicleId: string): Promise<void> {
        await tx.execute(sql`select pg_advisory_xact_lock(${this.lockKey(vehicleId)})`);
    }

    /** The hold as the caller reads it, at the version it sent (a hold changed meanwhile is a 409, not a lost update). */
    private async current(tx: Tx, id: string, version: number): Promise<Row> {
        const [row] = await tx.select().from(vehicleEncumbrances).where(eq(vehicleEncumbrances.id, id));
        if (!row) throw new NotFoundError();
        if (row.rowVersion !== version)
            throw new ConflictError('stale_version', {
                detailKey: 'kernel.detail.version_changed_current',
                params: { expected: String(version), current: String(row.rowVersion) }
            });
        return row;
    }

    /** A hold waiting for its release's confirmation, in the caller's subtree, whose release another person asked for. */
    private async pending(tx: Tx, ctx: DbContext, id: string, version: number): Promise<Row> {
        const row = await this.current(tx, id, version);
        guardOffice(row, ctx, 'subtree');
        if (row.status !== 'release_pending')
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.encumbrance_not_pending' });
        if (row.releaseRequestedBy === ctx.userId)
            throw new ForbiddenError({ detailKey: 'vehicles.errors.encumbrance_own_request' });
        return row;
    }

    /** A letter the caller uploaded themselves (linking refuses one already kept by another record). */
    private async ownUpload(tx: Tx, ctx: DbContext, fileId: string, path: string): Promise<void> {
        const file = await getFile(tx, fileId).catch((error: unknown) => {
            if (error instanceof NotFoundError) return undefined;
            throw error;
        });
        if (!file || file.createdBy !== ctx.userId)
            throw fieldError(path, 'not_found', words('vehicles.errors.encumbrance_file_not_own'));
    }

    private async holders(tx: Tx, rows: readonly Row[]): Promise<Map<string, Record<string, string>>> {
        const found = await this.organisations.summaries(
            tx,
            rows.map((r) => r.holderOrganisationId)
        );
        return new Map(found.map((o) => [o.id, o.name]));
    }

    private async units(tx: Tx, ids: readonly string[]): Promise<Map<string, UnitRef>> {
        const out = new Map<string, UnitRef>();
        for (const part of chunks([...new Set(ids)]))
            for (const [id, ref] of await unitRefs(tx, part)) out.set(id, ref);
        return out;
    }

    private async one(tx: Tx, row: Row): Promise<Encumbrance> {
        const [one] = await this.many(tx, [row]);
        if (!one) throw new NotFoundError();
        return one;
    }

    private async many(tx: Tx, rows: readonly Row[]): Promise<Encumbrance[]> {
        const holders = await this.holders(tx, rows);
        const units = await this.units(
            tx,
            rows.map((r) => r.recordedUnitId)
        );
        const peopleIds = [...new Set(rows.flatMap((r) => [r.releaseRequestedBy, r.releasedBy]).filter(isString))];
        const people = new Map(
            peopleIds.length === 0
                ? []
                : (
                      await tx
                          .select({ id: users.id, name: users.displayName })
                          .from(users)
                          .where(inArray(users.id, peopleIds))
                  ).map((u) => [u.id, u.name])
        );
        const person = (id: string | null) => (id ? { id, name: people.get(id) ?? '' } : null);
        return rows.map((r) => ({
            id: r.id,
            version: r.rowVersion,
            vehicleId: r.vehicleId,
            kind: r.kind,
            status: r.status,
            holder: { id: r.holderOrganisationId, name: holders.get(r.holderOrganisationId) ?? {} },
            recordedUnit: units.get(r.recordedUnitId) ?? emptyRef(r.recordedUnitId),
            letterReference: r.letterReference,
            letterDate: r.letterDate,
            amountSantim: r.amountSantim === null ? null : r.amountSantim.toString(),
            note: r.note,
            letterFile: r.letterFileId ? { id: r.letterFileId } : null,
            recordedAt: r.createdAt.toISOString(),
            releaseReference: r.releaseReference,
            releaseDate: r.releaseDate,
            releaseFile: r.releaseFileId ? { id: r.releaseFileId } : null,
            releaseNote: r.releaseNote,
            releaseRequestedBy: person(r.releaseRequestedBy),
            releaseRequestedAt: r.releaseRequestedAt?.toISOString() ?? null,
            releasedBy: person(r.releasedBy),
            releasedAt: r.releasedAt?.toISOString() ?? null,
            releaseRefusalReason: r.releaseRefusalReason
        }));
    }
}
