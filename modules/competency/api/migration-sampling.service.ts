/**
 * Sampling QA of migrated vehicles (ADR-0054 §3, task 1.13g). `count` runs in the transaction that puts a paper file's vehicle on
 * the register (a verified back-capture, or a committed sheet's row): the record counts to its clerk at the capturing office, and
 * the share the office's settings give is drawn (sampling.ts). A drawn record waits for a re-check against its scan by a third
 * person, neither its clerk nor its verifier (SEC-AC-6); the facts found wrong are counted per clerk. A re-check never changes the
 * vehicle: a correction is a service of its own.
 *
 * Idempotent: the draw commits or rolls back with the vehicle, and a vehicle is drawn at most once (unique on the vehicle). A
 * clerk's draws at an office are one after another (the counter is locked), so the share holds under concurrent commits.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { downloadLinkedFile, files, type ObjectStore } from '@itrms/kernel/files';
import { unitRefs } from '@itrms/kernel/org';
import { SettingsService } from '@itrms/kernel/settings';
import { users } from '@itrms/kernel/tables';
import { plateAssignments, vehicles } from '@itrms/vehicles/api';

import {
    DEFAULT_SAMPLE_PERCENT,
    MIGRATION_SAMPLE_SETTING,
    sampleShareSchema,
    type ClerkCounts,
    type MigrationSample,
    type MigrationSampleRecheck,
    type SampleState
} from '../contracts';
import { migrationSampleCounters, migrationSamples, vehicleImportRows } from './competency.table';
import { drawStep, type DrawCounter } from './sampling';

type SampleRow = typeof migrationSamples.$inferSelect;

/** Where a scan may be linked: a capture's request (its form submission) or a sheet. */
const SCAN_OWNERS = new Set(['forms.submissions', 'competency.vehicle_imports']);
const COUNTER_LOCK = 0x1e8c;
/** No one's id: what a context without a person compares with (it then sees no one's waiting records as its own). */
const NO_ONE = '00000000-0000-4000-8000-000000000000';

/** A record that joined the register from paper, as the draw counts it. */
export interface MigratedRecord {
    regionId: string;
    /** the capturing office: the clerk's records are counted there */
    handlingUnitId: string;
    vehicleId: string;
    origin: { source: 'back_capture'; caseId: string } | { source: 'import'; importRowId: string };
    clerkId: string;
    verifierId: string;
    /** the pages of the record's scan, in order (at most 20) */
    scanFileIds: string[];
}

@Injectable()
export class MigrationSamplingService {
    constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

    /** The share the office draws, in percent: its setting, or the default when the setting is not one. */
    async shareAt(tx: Tx, unitId: string): Promise<number> {
        const parsed = sampleShareSchema.safeParse(
            await this.settings.value<unknown>(tx, unitId, MIGRATION_SAMPLE_SETTING)
        );
        return parsed.success ? parsed.data : DEFAULT_SAMPLE_PERCENT;
    }

    /** Counts a record to its clerk and draws it when its place in the clerk's block is drawn. True when it is drawn. */
    async count(tx: Tx, record: MigratedRecord): Promise<boolean> {
        const share = await this.shareAt(tx, record.handlingUnitId);
        // one clerk's draws at an office one after another: the counter's row may not exist yet, so a lock of its key
        await tx.execute(
            sql`select pg_advisory_xact_lock(${COUNTER_LOCK}, hashtext(${`${record.handlingUnitId}:${record.clerkId}`}))`
        );
        const [counter] = await tx
            .select()
            .from(migrationSampleCounters)
            .where(
                and(
                    eq(migrationSampleCounters.handlingUnitId, record.handlingUnitId),
                    eq(migrationSampleCounters.clerkId, record.clerkId)
                )
            )
            .for('update');
        const was: DrawCounter | undefined = counter && {
            share: counter.share,
            blockSize: counter.blockSize,
            position: counter.blockPosition,
            picks: counter.blockPicks
        };
        const { next, drawn } = drawStep(was, share);
        const state = {
            share: next.share,
            blockSize: next.blockSize,
            blockPosition: next.position,
            blockPicks: next.picks
        };
        if (counter)
            await updateAudited(tx, migrationSampleCounters, counter.id, counter.rowVersion, {
                ...state,
                records: counter.records + 1,
                drawn: counter.drawn + (drawn ? 1 : 0)
            });
        else
            await insertAudited(tx, migrationSampleCounters, {
                regionId: record.regionId,
                handlingUnitId: record.handlingUnitId,
                clerkId: record.clerkId,
                ...state,
                records: 1,
                drawn: drawn ? 1 : 0
            });
        if (drawn)
            await insertAudited(tx, migrationSamples, {
                regionId: record.regionId,
                handlingUnitId: record.handlingUnitId,
                vehicleId: record.vehicleId,
                source: record.origin.source,
                caseId: record.origin.source === 'back_capture' ? record.origin.caseId : null,
                importRowId: record.origin.source === 'import' ? record.origin.importRowId : null,
                clerkId: record.clerkId,
                verifierId: record.verifierId,
                scanFileId: record.scanFileIds[0] ?? null,
                scanFileIds: record.scanFileIds,
                share
            });
        return drawn;
    }

    // ---- reading ----

    /**
     * What a person may see of the draw: never their own records still waiting for a re-check, so a clerk cannot tell which of
     * their records were drawn (and so which of the next will be) until someone has re-checked them.
     */
    private visibleTo(ctx: DbContext) {
        return sql`not (${migrationSamples.clerkId} = ${ctx.userId ?? NO_ONE} and ${migrationSamples.state} = 'drawn')`;
    }

    /** The drawn records the caller's office and those below it hold: those waiting first, oldest first. */
    async list(
        tx: Tx,
        ctx: DbContext,
        query: { state?: SampleState; vehicleId?: string; limit: number; offset: number },
        mayRecheck: boolean
    ): Promise<{ items: MigrationSample[]; total: number }> {
        const where = and(
            this.visibleTo(ctx),
            ...(query.state ? [eq(migrationSamples.state, query.state)] : []),
            ...(query.vehicleId ? [eq(migrationSamples.vehicleId, query.vehicleId)] : [])
        );
        const [total] = await tx.select({ n: count() }).from(migrationSamples).where(where);
        const rows = await tx
            .select()
            .from(migrationSamples)
            .where(where)
            .orderBy(
                sql`${migrationSamples.state} = 'rechecked'`,
                asc(migrationSamples.createdAt),
                asc(migrationSamples.id)
            )
            .limit(query.limit)
            .offset(query.offset);
        return { items: await this.out(tx, ctx, rows, mayRecheck), total: total?.n ?? 0 };
    }

    async get(tx: Tx, ctx: DbContext, id: string, mayRecheck: boolean): Promise<MigrationSample> {
        const [row] = await tx
            .select()
            .from(migrationSamples)
            .where(and(eq(migrationSamples.id, id), this.visibleTo(ctx)));
        if (!row) throw new NotFoundError();
        const [out] = await this.out(tx, ctx, [row], mayRecheck);
        if (!out) throw new NotFoundError();
        return out;
    }

    private async out(tx: Tx, ctx: DbContext, rows: SampleRow[], mayRecheck: boolean): Promise<MigrationSample[]> {
        if (rows.length === 0) return [];
        const vehicleIds = rows.map((r) => r.vehicleId);
        const facts = new Map(
            (
                await tx
                    .select({
                        id: vehicles.id,
                        chassisNumber: vehicles.chassisNumber,
                        paperReference: vehicles.paperReference
                    })
                    .from(vehicles)
                    .where(inArray(vehicles.id, vehicleIds))
            ).map((v) => [v.id, v])
        );
        const plates = new Map(
            (
                await tx
                    .select({ vehicleId: plateAssignments.vehicleId, text: plateAssignments.plateText })
                    .from(plateAssignments)
                    .where(and(inArray(plateAssignments.vehicleId, vehicleIds), isNull(plateAssignments.until)))
            ).map((p) => [p.vehicleId, p.text])
        );
        const rowIds = rows.flatMap((r) => (r.importRowId ? [r.importRowId] : []));
        const batches = new Map(
            rowIds.length === 0
                ? []
                : (
                      await tx
                          .select({ id: vehicleImportRows.id, importId: vehicleImportRows.importId })
                          .from(vehicleImportRows)
                          .where(inArray(vehicleImportRows.id, rowIds))
                  ).map((r) => [r.id, r.importId])
        );
        const people = [
            ...new Set(rows.flatMap((r) => [r.clerkId, r.verifierId, ...(r.recheckedBy ? [r.recheckedBy] : [])]))
        ];
        const names = new Map(
            (
                await tx.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, people))
            ).map((u) => [u.id, u.name])
        );
        const units = await unitRefs(
            tx,
            rows.map((r) => r.handlingUnitId)
        );
        const scanIds = [...new Set(rows.flatMap((r) => r.scanFileIds))];
        const filenames = new Map(
            scanIds.length === 0
                ? []
                : (
                      await tx
                          .select({ id: files.id, filename: files.filename })
                          .from(files)
                          .where(inArray(files.id, scanIds))
                  ).map((f) => [f.id, f.filename])
        );
        const person = (id: string) => ({ id, name: names.get(id) ?? '' });
        return rows.map((r) => {
            const vehicle = facts.get(r.vehicleId);
            return {
                id: r.id,
                version: r.rowVersion,
                source: r.source,
                vehicle: {
                    id: r.vehicleId,
                    plate: plates.get(r.vehicleId) ?? null,
                    chassisNumber: vehicle?.chassisNumber ?? '',
                    paperReference: vehicle?.paperReference ?? null
                },
                caseId: r.caseId,
                importRowId: r.importRowId,
                importId: r.importRowId ? (batches.get(r.importRowId) ?? null) : null,
                clerk: person(r.clerkId),
                verifier: person(r.verifierId),
                hasScan: r.scanFileId !== null,
                scans: r.scanFileIds.map((id) => ({ id, filename: filenames.get(id) ?? '' })),
                share: r.share,
                state: r.state,
                outcome: r.outcome,
                errorFields: r.errorFields,
                note: r.note,
                recheckedBy: r.recheckedBy ? person(r.recheckedBy) : null,
                recheckedAt: r.recheckedAt?.toISOString() ?? null,
                drawnAt: r.createdAt.toISOString(),
                unit: units.get(r.handlingUnitId) ?? { id: r.handlingUnitId, code: '', name: {} },
                mayRecheck: mayRecheck && r.state === 'drawn' && !this.isOwn(r, ctx.userId)
            };
        });
    }

    /** Whether the person captured or verified the record: they may not be its re-check. */
    private isOwn(row: SampleRow, userId: string | undefined): boolean {
        return !userId || row.clerkId === userId || row.verifierId === userId;
    }

    /** A short link to one page of the drawn record's scan; the download is on record. */
    async scanLink(
        tx: Tx,
        ctx: DbContext,
        store: ObjectStore,
        id: string,
        fileId: string
    ): Promise<{ url: string; expiresAt: string }> {
        const [row] = await tx
            .select()
            .from(migrationSamples)
            .where(and(eq(migrationSamples.id, id), this.visibleTo(ctx)));
        if (!row?.scanFileIds.includes(fileId)) throw new NotFoundError();
        const [file] = await tx
            .select({ table: files.linkedTable, id: files.linkedId })
            .from(files)
            .where(eq(files.id, fileId));
        if (!file?.table || !file.id || !SCAN_OWNERS.has(file.table)) throw new NotFoundError();
        return downloadLinkedFile(tx, store, fileId, { table: file.table, id: file.id });
    }

    /**
     * Each clerk's migration at the offices the caller sees: records, drawn, re-checked, with errors and the errors found. Never
     * the caller's own: their records and draws so far would tell them where the next draw falls.
     */
    async clerks(tx: Tx, ctx: DbContext): Promise<ClerkCounts[]> {
        const rows = await tx
            .select({
                unitId: migrationSampleCounters.handlingUnitId,
                clerkId: migrationSampleCounters.clerkId,
                records: migrationSampleCounters.records,
                drawn: migrationSampleCounters.drawn,
                rechecked: sql<number>`count(${migrationSamples.id}) filter (where ${migrationSamples.state} = 'rechecked')::int`,
                withErrors: sql<number>`count(${migrationSamples.id}) filter (where ${migrationSamples.outcome} = 'errors')::int`,
                errors: sql<number>`coalesce(sum(cardinality(${migrationSamples.errorFields})), 0)::int`
            })
            .from(migrationSampleCounters)
            .leftJoin(
                migrationSamples,
                and(
                    eq(migrationSamples.handlingUnitId, migrationSampleCounters.handlingUnitId),
                    eq(migrationSamples.clerkId, migrationSampleCounters.clerkId)
                )
            )
            .where(ne(migrationSampleCounters.clerkId, ctx.userId ?? NO_ONE))
            .groupBy(migrationSampleCounters.id)
            .orderBy(asc(migrationSampleCounters.handlingUnitId), asc(migrationSampleCounters.clerkId))
            .limit(500);
        if (rows.length === 0) return [];
        const names = new Map(
            (
                await tx
                    .select({ id: users.id, name: users.displayName })
                    .from(users)
                    .where(
                        inArray(
                            users.id,
                            rows.map((r) => r.clerkId)
                        )
                    )
            ).map((u) => [u.id, u.name])
        );
        const units = await unitRefs(
            tx,
            rows.map((r) => r.unitId)
        );
        return rows.map((r) => ({
            unit: units.get(r.unitId) ?? { id: r.unitId, code: '', name: {} },
            clerk: { id: r.clerkId, name: names.get(r.clerkId) ?? '' },
            records: r.records,
            drawn: r.drawn,
            rechecked: r.rechecked,
            withErrors: r.withErrors,
            errors: r.errors
        }));
    }

    // ---- the re-check ----

    /**
     * A third person compared the record with its scan: correct, or the facts found wrong. Never its clerk nor its verifier
     * (SEC-AC-6), from its office or one above it (RLS: only those see it); once only.
     */
    async recheck(
        tx: Tx,
        ctx: DbContext,
        id: string,
        version: number,
        input: MigrationSampleRecheck
    ): Promise<MigrationSample> {
        const [row] = await tx.select().from(migrationSamples).where(eq(migrationSamples.id, id)).for('update');
        if (!row) throw new NotFoundError();
        if (row.rowVersion !== version) throw new ConflictError('stale_version');
        if (this.isOwn(row, ctx.userId))
            throw new ForbiddenError({ detailKey: 'competency.errors.recheck_own_record' });
        if (row.state !== 'drawn')
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.sample_rechecked' });
        await updateAudited(tx, migrationSamples, id, row.rowVersion, {
            state: 'rechecked',
            outcome: input.outcome,
            errorFields: input.outcome === 'errors' ? [...input.fields] : [],
            note: input.note ?? null,
            recheckedBy: ctx.userId,
            recheckedAt: new Date()
        });
        return this.get(tx, ctx, id, true);
    }
}
