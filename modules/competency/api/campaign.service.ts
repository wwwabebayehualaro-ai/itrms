/**
 * Campaign counters (ADR-0054 §2, task 1.13i): a unit runs a campaign (the plate exchange, the bolo season) over a span of days, sets
 * a target for each office below it, and the dashboard shows each office's daily count against its target. What is counted comes from
 * typed tables: plates that gave way to the national plate on their day (vehicles.plate_assignments, ended as `exchanged`) and bolos
 * inspected on their day (competency.bolos, not void). Both registers are read region-wide by RLS (class R), so every count here is
 * limited by hand to the caller's subtree and to the campaign's unit, as the migration report's register counts are.
 *
 * An office sees a campaign through RLS itself: `campaigns` is class C, read by the offices below the unit that runs it, and an
 * office's target row is class T at the office. No function bypasses a policy.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { currentContext } from '@itrms/kernel/context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { unitRefs, type UnitRef } from '@itrms/kernel/org';

import {
    addisDay,
    CAMPAIGN_SERIES_DAYS,
    type Campaign,
    type CampaignCreateInput,
    type CampaignKind,
    type CampaignList,
    type CampaignOffice,
    type CampaignProgress,
    type CampaignTargetInput
} from '../contracts';
import { campaignTargets, campaigns } from './competency.table';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { daysAfter } from './bolo-validity';
import { expectedBy, onTrack, seriesOf, totalsOf } from './campaigns';

/** One unit's campaigns of one kind are made one at a time, so two of them cannot overlap (the advisory lock's first key). */
const CAMPAIGN_LOCK = 0x1e90;
/** An office's target in a campaign is written one at a time. */
const TARGET_LOCK = 0x1e91;
/** kernel.region_units answers at most this many units per call */
const REFS_PER_CALL = 200;
/** the campaigns a list shows */
const LIST_LIMIT = 200;

/** A refusal in the language of the person acting. */
const say = (key: keyof typeof en): string => (currentContext()?.language === 'en' ? en : am)[key];

type CampaignRow = typeof campaigns.$inferSelect;

/** What a campaign counts: the table, the day it counts on and the rows that count, all constants of the code. */
const SOURCES: Record<CampaignKind, { from: SQL; day: SQL; counted: SQL }> = {
    plate_exchange: {
        from: sql`vehicles.plate_assignments x`,
        day: sql`x.until`,
        counted: sql`x.ended_reason = 'exchanged'`
    },
    bolo_season: {
        from: sql`competency.bolos x`,
        day: sql`x.inspected_on`,
        counted: sql`x.status <> 'void'`
    }
};

@Injectable()
export class CampaignService {
    /** The campaigns the caller reads: those their unit runs or holds below it, and those of the units above that target it. */
    async list(tx: Tx, mayManage: boolean): Promise<CampaignList> {
        const rows = await tx
            .select()
            .from(campaigns)
            .orderBy(desc(campaigns.startsOn), campaigns.id)
            .limit(LIST_LIMIT);
        const units = await this.refs(
            tx,
            rows.map((r) => r.handlingUnitId)
        );
        return { items: rows.map((r) => this.view(r, units)), mayManage };
    }

    /** A new campaign of the caller's active unit: its span is checked by the contract, and it may not overlap an open one of its kind. */
    async create(tx: Tx, ctx: DbContext, input: CampaignCreateInput): Promise<Campaign> {
        const unitId = ctx.unitId;
        if (!unitId || !ctx.regionId) throw new ForbiddenError({ detailKey: 'competency.errors.campaign_not_yours' });
        await tx.execute(sql`select pg_advisory_xact_lock(${CAMPAIGN_LOCK}, hashtext(${`${unitId}:${input.kind}`}))`);
        const overlapping = await tx
            .select({ id: campaigns.id })
            .from(campaigns)
            .where(
                and(
                    eq(campaigns.handlingUnitId, unitId),
                    eq(campaigns.kind, input.kind),
                    isNull(campaigns.closedAt),
                    sql`${campaigns.startsOn} <= ${input.endsOn}::date and ${campaigns.endsOn} >= ${input.startsOn}::date`
                )
            )
            .limit(1);
        if (overlapping.length > 0)
            throw new ConflictError('duplicate_reference', { detailKey: 'competency.errors.campaign_overlap' });
        const created = await insertAudited(tx, campaigns, {
            regionId: ctx.regionId,
            handlingUnitId: unitId,
            kind: input.kind,
            name: input.name,
            startsOn: input.startsOn,
            endsOn: input.endsOn
        });
        return this.view(created, await this.refs(tx, [unitId]));
    }

    /** A campaign with each office's count against its target, as far as the caller's subtree holds. */
    async progress(tx: Tx, ctx: DbContext, id: string, mayManage: boolean): Promise<CampaignProgress> {
        const campaign = await this.load(tx, id);
        const today = addisDay();
        const todayCounted = today >= campaign.startsOn;
        // the window the counts are of: the campaign's days that have come by; the series ends where it ends
        const windowEnd = today < campaign.endsOn ? today : campaign.endsOn;
        const [targets, totals, byDay] = await Promise.all([
            tx.select().from(campaignTargets).where(eq(campaignTargets.campaignId, id)),
            todayCounted ? this.totals(tx, campaign, windowEnd) : Promise.resolve(new Map<string, number>()),
            todayCounted ? this.byDay(tx, campaign, windowEnd) : Promise.resolve(new Map<string, Map<string, number>>())
        ]);
        const ids = new Set<string>([...targets.map((t) => t.handlingUnitId), ...totals.keys()]);
        const units = await this.refs(tx, [campaign.handlingUnitId, ...ids]);
        const seriesEnd = todayCounted ? windowEnd : today;
        const offices = [...ids]
            .map((unitId): CampaignOffice => {
                const target = targets.find((t) => t.handlingUnitId === unitId);
                const series = seriesOf(byDay.get(unitId) ?? new Map(), seriesEnd);
                const total = totals.get(unitId) ?? 0;
                const expected = target ? expectedBy(target.target, campaign.startsOn, campaign.endsOn, today) : null;
                return {
                    unit: units.get(unitId) ?? { id: unitId, code: '', name: {} },
                    target: target ? { count: target.target, version: target.rowVersion } : null,
                    today: series.find((d) => d.day === today)?.count ?? 0,
                    total,
                    expected,
                    onTrack: expected === null ? null : onTrack(total, expected),
                    series
                };
            })
            .sort((a, b) => a.unit.code.localeCompare(b.unit.code) || a.unit.id.localeCompare(b.unit.id));
        return {
            campaign: this.view(campaign, units),
            offices,
            total: totalsOf(
                offices.map((o) => ({
                    today: o.today,
                    total: o.total,
                    target: o.target?.count ?? null,
                    expected: o.expected
                }))
            ),
            mayManage: mayManage && (await this.relation(tx, ctx, campaign.handlingUnitId))?.atOrAbove === true,
            ownUnitId: ctx.unitId ?? null
        };
    }

    /**
     * An office's target in a campaign. The office is below the campaign's unit and below the caller's active unit, never the
     * caller's own: an office does not set its own target. Without a version the target is new; with one it replaces the target it
     * is based on.
     */
    async setTarget(
        tx: Tx,
        ctx: DbContext,
        id: string,
        input: CampaignTargetInput,
        version: number | undefined,
        mayManage: boolean
    ): Promise<CampaignProgress> {
        const campaign = await this.load(tx, id);
        if (campaign.closedAt)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.campaign_closed' });
        const counter = ctx.unitId;
        const { rows: found } = await tx.execute<{
            region_id: string;
            by_caller: boolean | null;
            in_campaign: boolean | null;
        }>(sql`
            select h.region_id,
                   (a.path @> h.path and a.id <> h.id) as by_caller,
                   (c.path @> h.path and c.id <> h.id) as in_campaign
              from kernel.org_units h
              left join kernel.org_units a on a.id = ${counter ?? null}
              left join kernel.org_units c on c.id = ${campaign.handlingUnitId}
             where h.id = ${input.unitId}`);
        const unit = found[0];
        if (!unit) throw new NotFoundError();
        if (!counter || unit.by_caller !== true)
            throw new ForbiddenError({ detailKey: 'competency.errors.campaign_target_own_office' });
        if (unit.in_campaign !== true)
            throw new ValidationError('validation_failed', {
                errors: [
                    { path: 'unitId', code: 'outside_campaign', message: say('competency.errors.campaign_outside') }
                ]
            });
        // two first targets of one office at once: the second waits and finds the first (never a unique violation)
        await tx.execute(sql`select pg_advisory_xact_lock(${TARGET_LOCK}, hashtext(${`${id}:${input.unitId}`}))`);
        const [current] = await tx
            .select()
            .from(campaignTargets)
            .where(and(eq(campaignTargets.campaignId, id), eq(campaignTargets.handlingUnitId, input.unitId)))
            .for('update');
        const changes = { target: input.target, setByUnitId: counter };
        if (current) {
            if (version === undefined || current.rowVersion !== version) throw new ConflictError('stale_version');
            await updateAudited(tx, campaignTargets, current.id, current.rowVersion, changes);
        } else {
            if (version !== undefined) throw new ConflictError('stale_version');
            await insertAudited(tx, campaignTargets, {
                regionId: unit.region_id,
                handlingUnitId: input.unitId,
                campaignId: id,
                ...changes
            });
        }
        return this.progress(tx, ctx, id, mayManage);
    }

    /** Closes a campaign: by the unit that runs it or one above it, on its version. A closed campaign takes no more targets. */
    async close(tx: Tx, ctx: DbContext, id: string, version: number, mayManage: boolean): Promise<CampaignProgress> {
        const campaign = await this.load(tx, id);
        if ((await this.relation(tx, ctx, campaign.handlingUnitId))?.atOrAbove !== true)
            throw new ForbiddenError({ detailKey: 'competency.errors.campaign_not_yours' });
        if (campaign.closedAt)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.campaign_closed' });
        if (campaign.rowVersion !== version) throw new ConflictError('stale_version');
        await updateAudited(tx, campaigns, campaign.id, campaign.rowVersion, { closedAt: new Date() });
        return this.progress(tx, ctx, id, mayManage);
    }

    private async load(tx: Tx, id: string): Promise<CampaignRow> {
        const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, id));
        if (!row) throw new NotFoundError();
        return row;
    }

    /** Whether the caller's active unit is the campaign's unit or above it. */
    private async relation(tx: Tx, ctx: DbContext, unitId: string): Promise<{ atOrAbove: boolean } | undefined> {
        if (!ctx.unitId) return undefined;
        const { rows } = await tx.execute<{ at_or_above: boolean | null }>(sql`
            select (a.path @> h.path) as at_or_above
              from kernel.org_units h, kernel.org_units a
             where h.id = ${unitId} and a.id = ${ctx.unitId}`);
        return { atOrAbove: rows[0]?.at_or_above === true };
    }

    /** Each counted record of the window per office: the campaign's unit's subtree, the caller's subtree, nothing else. */
    private async totals(tx: Tx, campaign: CampaignRow, to: string): Promise<Map<string, number>> {
        const source = SOURCES[campaign.kind];
        const { rows } = await tx.execute<{ unit_id: string; n: number }>(sql`
            select x.handling_unit_id as unit_id, count(*)::int as n
              from ${source.from}
             where ${source.counted}
               and ${source.day} between ${campaign.startsOn}::date and ${to}::date
               and x.handling_org_path <@ (select kernel.ctx_scope())
               and x.handling_org_path <@ ${campaign.orgPath}::ltree
             group by x.handling_unit_id`);
        return new Map(rows.map((r) => [r.unit_id, r.n]));
    }

    /** The last days' counts per office and day, within the campaign's days (the series is zero-filled by the caller). */
    private async byDay(tx: Tx, campaign: CampaignRow, to: string): Promise<Map<string, Map<string, number>>> {
        const source = SOURCES[campaign.kind];
        const from = daysAfter(to, 1 - CAMPAIGN_SERIES_DAYS);
        const { rows } = await tx.execute<{ unit_id: string; day: string; n: number }>(sql`
            select x.handling_unit_id as unit_id, (${source.day})::text as day, count(*)::int as n
              from ${source.from}
             where ${source.counted}
               and ${source.day} between greatest(${from}::date, ${campaign.startsOn}::date) and ${to}::date
               and x.handling_org_path <@ (select kernel.ctx_scope())
               and x.handling_org_path <@ ${campaign.orgPath}::ltree
             group by x.handling_unit_id, ${source.day}`);
        const out = new Map<string, Map<string, number>>();
        for (const r of rows) {
            const days = out.get(r.unit_id) ?? new Map<string, number>();
            days.set(r.day, r.n);
            out.set(r.unit_id, days);
        }
        return out;
    }

    private async refs(tx: Tx, ids: readonly string[]): Promise<Map<string, UnitRef>> {
        const all = [...new Set(ids)];
        const units = new Map<string, UnitRef>();
        for (let i = 0; i < all.length; i += REFS_PER_CALL)
            for (const [k, v] of await unitRefs(tx, all.slice(i, i + REFS_PER_CALL))) units.set(k, v);
        return units;
    }

    private view(row: CampaignRow, units: ReadonlyMap<string, UnitRef>): Campaign {
        return {
            id: row.id,
            kind: row.kind,
            name: row.name,
            startsOn: row.startsOn,
            endsOn: row.endsOn,
            closedAt: row.closedAt ? row.closedAt.toISOString() : null,
            unit: units.get(row.handlingUnitId) ?? { id: row.handlingUnitId, code: '', name: {} },
            version: row.rowVersion
        };
    }
}
