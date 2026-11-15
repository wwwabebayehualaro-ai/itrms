/**
 * The reconciliation report of the paper-record migration (ADR-0054 §4, task 1.13h): per office and plate-code group, the zone's count
 * of paper files against the vehicles verified onto the register, what is awaiting its second person, and the share migrated.
 * Typed tables only. The register is read region-wide by RLS (class R), so every register query here is limited to the caller's
 * subtree by hand: the report shows the offices the caller's active unit holds, as the other lists do.
 */
import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { currentContext } from '@itrms/kernel/context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { effectiveServices, unitRefs, type UnitRef } from '@itrms/kernel/org';
import { cases } from '@itrms/workflow/api';

import {
    addisDay,
    BACK_CAPTURE_SERVICE,
    PAPER_PLATE_CODES,
    type MigrationReport,
    type PaperCountInput,
    type PaperPlateCode,
    type ReconciliationOffice
} from '../contracts';
import { migrationPaperCounts, vehicleImportRows, vehicleImports } from './competency.table';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { missingOf, plateCodeOf, sumsOf } from './reconciliation';

/** One office's count of one plate code is written one at a time (the advisory lock's first key). */
const PAPER_COUNT_LOCK = 0x1e8d;
/** kernel.region_units answers at most this many units per call */
const REFS_PER_CALL = 200;

/** A refusal in the language of the person acting. */
const say = (key: keyof typeof en): string => (currentContext()?.language === 'en' ? en : am)[key];

@Injectable()
export class MigrationReportService {
    /** The offices the caller sees (those with a paper count, a migrated vehicle or work awaiting), by unit code. */
    async report(tx: Tx, ctx: DbContext, mayCount: boolean): Promise<MigrationReport> {
        const offices = await this.offices(tx);
        return {
            offices,
            total: {
                awaiting: {
                    captures: offices.reduce((n, o) => n + o.awaiting.captures, 0),
                    importRows: offices.reduce((n, o) => n + o.awaiting.importRows, 0)
                },
                // over the offices' codes: a code nobody counted at one office does not enter the share of another
                ...sumsOf(
                    offices.flatMap((o) =>
                        o.codes.map((c) => ({ paper: c.paper?.count ?? null, verified: c.verified }))
                    )
                )
            },
            mayCount,
            ownUnitId: ctx.unitId ?? null
        };
    }

    private async offices(tx: Tx, only?: string): Promise<ReconciliationOffice[]> {
        const [verified, papers, captures, importRows] = await Promise.all([
            this.verified(tx, only),
            tx
                .select()
                .from(migrationPaperCounts)
                .where(only ? eq(migrationPaperCounts.handlingUnitId, only) : undefined),
            this.captures(tx, only),
            this.importRows(tx, only)
        ]);
        const ids = new Set<string>([
            ...verified.keys(),
            ...papers.map((p) => p.handlingUnitId),
            ...captures.keys(),
            ...importRows.keys()
        ]);
        if (ids.size === 0) return [];
        const all = [...ids];
        const units = new Map<string, UnitRef>();
        for (let i = 0; i < all.length; i += REFS_PER_CALL)
            for (const [k, v] of await unitRefs(tx, all.slice(i, i + REFS_PER_CALL))) units.set(k, v);
        return [...ids]
            .map((id) => {
                const codes = PAPER_PLATE_CODES.map((plateCode) => {
                    const paper = papers.find((p) => p.handlingUnitId === id && p.plateCode === plateCode);
                    const done = verified.get(id)?.get(plateCode) ?? 0;
                    return {
                        plateCode,
                        paper: paper
                            ? { count: paper.count, countedOn: paper.countedOn, version: paper.rowVersion }
                            : null,
                        verified: done,
                        missing: missingOf(paper?.count ?? null, done)
                    };
                });
                return {
                    unit: units.get(id) ?? { id, code: '', name: {} },
                    codes,
                    awaiting: { captures: captures.get(id) ?? 0, importRows: importRows.get(id) ?? 0 },
                    ...sumsOf(codes.map((c) => ({ paper: c.paper?.count ?? null, verified: c.verified })))
                };
            })
            .sort((a, b) => a.unit.code.localeCompare(b.unit.code) || a.unit.id.localeCompare(b.unit.id));
    }

    /**
     * Vehicles on the register with a migration source, per handling office and plate code. The code is that of the vehicle's
     * earliest plate assignment: the plate its paper file is shelved by.
     */
    private async verified(tx: Tx, only?: string): Promise<Map<string, Map<PaperPlateCode, number>>> {
        const { rows } = await tx.execute<{ unit_id: string; use_code: number | null; n: number }>(sql`
            select v.handling_unit_id as unit_id, p.legacy_use_code as use_code, count(*)::int as n
              from vehicles.vehicles v
              left join lateral (
                    select pa.legacy_use_code from vehicles.plate_assignments pa
                     where pa.vehicle_id = v.id
                     order by pa.since, pa.created_at limit 1) p on true
             where v.migration_source is not null
               and v.handling_org_path <@ (select kernel.ctx_scope())
               ${only ? sql`and v.handling_unit_id = ${only}` : sql``}
             group by v.handling_unit_id, p.legacy_use_code`);
        const out = new Map<string, Map<PaperPlateCode, number>>();
        for (const r of rows) {
            const byCode = out.get(r.unit_id) ?? new Map<PaperPlateCode, number>();
            const code = plateCodeOf(r.use_code);
            byCode.set(code, (byCode.get(code) ?? 0) + r.n);
            out.set(r.unit_id, byCode);
        }
        return out;
    }

    /** Open back-capture cases per handling office: captured, their second person not yet done. */
    private async captures(tx: Tx, only?: string): Promise<Map<string, number>> {
        const rows = await tx
            .select({ unitId: cases.handlingUnitId, n: count() })
            .from(cases)
            .where(
                and(
                    isNull(cases.closedAt),
                    sql`${cases.config} ->> 'serviceCode' = ${BACK_CAPTURE_SERVICE}`,
                    only ? eq(cases.handlingUnitId, only) : undefined
                )
            )
            .groupBy(cases.handlingUnitId);
        return new Map(rows.map((r) => [r.unitId, r.n]));
    }

    /** Valid rows of checked or committing sheets per importing office: they join the register when the sheet is committed. */
    private async importRows(tx: Tx, only?: string): Promise<Map<string, number>> {
        const rows = await tx
            .select({ unitId: vehicleImports.handlingUnitId, n: count() })
            .from(vehicleImportRows)
            .innerJoin(vehicleImports, eq(vehicleImports.id, vehicleImportRows.importId))
            .where(
                and(
                    eq(vehicleImportRows.state, 'valid'),
                    inArray(vehicleImports.state, ['checked', 'committing']),
                    only ? eq(vehicleImports.handlingUnitId, only) : undefined
                )
            )
            .groupBy(vehicleImports.handlingUnitId);
        return new Map(rows.map((r) => [r.unitId, r.n]));
    }

    /**
     * The zone's count of paper files for an office and code. The office is below the caller's active unit, never the caller's own:
     * an office does not set its own target. Without a version the count is new; with one it replaces the count it is based on.
     */
    async setPaperCount(
        tx: Tx,
        ctx: DbContext,
        input: PaperCountInput,
        version: number | undefined
    ): Promise<ReconciliationOffice> {
        const { rows: found } = await tx.execute<{ region_id: string; above: boolean | null }>(sql`
            select h.region_id, (a.path @> h.path and a.id <> h.id) as above
              from kernel.org_units h
              left join kernel.org_units a on a.id = ${ctx.unitId ?? null}
             where h.id = ${input.unitId}`);
        const unit = found[0];
        if (!unit) throw new NotFoundError();
        if (unit.above !== true) throw new ForbiddenError({ detailKey: 'competency.errors.paper_count_own_office' });
        // the unit above checked it is the caller's active unit; the database refuses an office counting itself too
        const counter = ctx.unitId;
        if (!counter) throw new ForbiddenError({ detailKey: 'competency.errors.paper_count_own_office' });
        // only an office that migrates paper files has a count to reconcile (ADR-0026: its services)
        if (!(await effectiveServices(tx, input.unitId)).includes(BACK_CAPTURE_SERVICE))
            throw new ValidationError('validation_failed', {
                errors: [
                    { path: 'unitId', code: 'not_offered', message: say('competency.errors.paper_count_not_offered') }
                ]
            });
        if (input.countedOn > addisDay())
            throw new ValidationError('validation_failed', {
                errors: [
                    { path: 'countedOn', code: 'future_date', message: say('competency.errors.paper_count_future') }
                ]
            });
        // two first counts of one office and code at once: the second waits and finds the first (never a unique violation)
        await tx.execute(
            sql`select pg_advisory_xact_lock(${PAPER_COUNT_LOCK}, hashtext(${`${input.unitId}:${input.plateCode}`}))`
        );
        const [current] = await tx
            .select()
            .from(migrationPaperCounts)
            .where(
                and(
                    eq(migrationPaperCounts.handlingUnitId, input.unitId),
                    eq(migrationPaperCounts.plateCode, input.plateCode)
                )
            )
            .for('update');
        const changes = { count: input.count, countedOn: input.countedOn, countedByUnitId: counter };
        if (current) {
            if (version === undefined || current.rowVersion !== version) throw new ConflictError('stale_version');
            await updateAudited(tx, migrationPaperCounts, current.id, current.rowVersion, changes);
        } else {
            if (version !== undefined) throw new ConflictError('stale_version');
            await insertAudited(tx, migrationPaperCounts, {
                regionId: unit.region_id,
                handlingUnitId: input.unitId,
                plateCode: input.plateCode,
                ...changes
            });
        }
        const [office] = await this.offices(tx, input.unitId);
        if (!office) throw new NotFoundError();
        return office;
    }
}
