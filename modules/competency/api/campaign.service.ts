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
import { effectiveServices, unitRefs, type UnitRef } from '@itrms/kernel/org';

import {
    addisDay,
    CAMPAIGN_SERIES_DAYS,
    CAMPAIGN_SERVICES,
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
import { countingEnd, expectedBy, onTrack, seriesOf, totalsOf } from './campaigns';

/** One unit's campaigns of one kind are made one at a time, so two of them cannot overlap (the advisory lock's first key). */
const CAMPAIGN_LOCK = 0x1e90;
/** An office's target in a campaign is written one at a time. */
const TARGET_LOCK = 0x1e91;
/** A campaign is closed one at a time and its targets are set under the shared lock, so a target never lands on a closed campaign. */
const CLOSE_LOCK = 0x1e92;
/** the offices a campaign offers for a first target */
const CANDIDATE_LIMIT = 300;
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
    async list(tx: Tx, ctx: DbContext, mayManage: boolean): Promise<CampaignList> {
        const rows = await tx
            .select()
            .from(campaigns)
            .orderBy(desc(campaigns.startsOn), campaigns.id)
            .limit(LIST_LIMIT);
        const units = await this.refs(
            tx,
            rows.map((r) => r.handlingUnitId)
        );
        // the campaigns of the caller's unit and the units above it, apart from those started below
        const above = new Set<string>();
        if (ctx.unitId && rows.length > 0) {
            const { rows: found } = await tx.execute<{ id: string }>(sql`
                select c.id
                  from competency.campaigns c
                  join kernel.org_units h on h.id = c.handling_unit_id
                  join kernel.org_units a on a.id = ${ctx.unitId}
                 where h.path @> a.path and c.id = any(${`{${rows.map((r) => r.id).join(',')}}`}::uuid[])`);
            for (const r of found) above.add(r.id);
        }
        return {
            items: rows.map((r) => this.view(r, units)),
            mayManage,
            heldAbove: rows.map((r) => r.id).filter((i) => above.has(i))
        };
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
        // the window the counts are of: the campaign's days that have come by, and none after the day it was closed; the series ends there
        const windowEnd = countingEnd(campaign.endsOn, campaign.closedAt ? addisDay(campaign.closedAt) : null, today);
        const counting = windowEnd >= campaign.startsOn;
        const [targets, totals, byDay] = await Promise.all([
            tx.select().from(campaignTargets).where(eq(campaignTargets.campaignId, id)),
            counting ? this.totals(tx, campaign, windowEnd) : Promise.resolve(new Map<string, number>()),
            counting ? this.byDay(tx, campaign, windowEnd) : Promise.resolve(new Map<string, Map<string, number>>())
        ]);
        const candidates = mayManage && !campaign.closedAt ? await this.candidates(tx, ctx, campaign) : [];
        const ids = new Set<string>([...targets.map((t) => t.handlingUnitId), ...totals.keys()]);
        const units = await this.refs(tx, [campaign.handlingUnitId, ...ids, ...candidates]);
        const seriesEnd = windowEnd;
        const offices = [...ids]
            .map((unitId): CampaignOffice => {
                const target = targets.find((t) => t.handlingUnitId === unitId);
                const series = seriesOf(byDay.get(unitId) ?? new Map(), seriesEnd);
                const total = totals.get(unitId) ?? 0;
                const expected = target
                    ? expectedBy(target.target, campaign.startsOn, campaign.endsOn, windowEnd)
                    : null;
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
        const atOrAbove = (await this.relation(tx, ctx, campaign.handlingUnitId))?.atOrAbove === true;
        // a unit below the campaign's may set the targets of its own offices: it has some to give, or has given some
        const mayTarget =
            mayManage && (atOrAbove || candidates.length > 0 || (await this.hasTargetsBelow(tx, ctx, id)));
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
            mayManage: mayTarget,
            mayClose: mayManage && atOrAbove,
            candidates: candidates.map((u) => units.get(u) ?? { id: u, code: '', name: {} }),
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
        // shared with other targets, exclusive against the closing: the campaign is read after the lock, so a close that came first is seen
        await tx.execute(sql`select pg_advisory_xact_lock_shared(${CLOSE_LOCK}, hashtext(${id}))`);
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
        // the office is given a target for what it holds: it must offer the service whose records the campaign counts
        if (!(await effectiveServices(tx, input.unitId)).includes(CAMPAIGN_SERVICES[campaign.kind]))
            throw new ValidationError('validation_failed', {
                errors: [
                    {
                        path: 'unitId',
                        code: 'service_not_offered',
                        message: say('competency.errors.campaign_service_not_offered')
                    }
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
        await tx.execute(sql`select pg_advisory_xact_lock(${CLOSE_LOCK}, hashtext(${id}))`);
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

    /**
     * The offices the caller may give a first target: active units below both the campaign's unit and the caller's, with no target yet,
     * that offer the service the campaign counts (the unit type's default with the unit's own override, as effectiveServices reads it,
     * for all of them in one query). At most CANDIDATE_LIMIT, by code.
     */
    private async candidates(tx: Tx, ctx: DbContext, campaign: CampaignRow): Promise<string[]> {
        if (!ctx.unitId) return [];
        const service = CAMPAIGN_SERVICES[campaign.kind];
        const { rows } = await tx.execute<{ id: string }>(sql`
            select u.id
              from kernel.org_units u
              join kernel.org_units a on a.id = ${ctx.unitId}
             where u.active
               and a.path @> u.path and u.id <> a.id
               and ${campaign.orgPath}::ltree @> u.path and u.id <> ${campaign.handlingUnitId}
               and not exists (select 1 from competency.campaign_targets t
                                where t.campaign_id = ${campaign.id} and t.handling_unit_id = u.id)
               and coalesce(
                     (select o.enabled from kernel.unit_service_overrides o
                       where o.org_unit_id = u.id and o.service_code = ${service}),
                     (select s.enabled from kernel.unit_type_services s
                       where s.unit_type_id = u.unit_type_id and s.service_code = ${service}),
                     false)
             order by u.code, u.id
             limit ${CANDIDATE_LIMIT}`);
        return rows.map((r) => r.id);
    }

    /** Whether the campaign has a target at an office strictly below the caller's active unit. */
    private async hasTargetsBelow(tx: Tx, ctx: DbContext, id: string): Promise<boolean> {
        if (!ctx.unitId) return false;
        const { rows } = await tx.execute<{ found: boolean }>(sql`
            select exists (
                select 1 from competency.campaign_targets t
                  join kernel.org_units u on u.id = t.handling_unit_id
                  join kernel.org_units a on a.id = ${ctx.unitId}
                 where t.campaign_id = ${id} and a.path @> u.path and u.id <> a.id) as found`);
        return rows[0]?.found === true;
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
