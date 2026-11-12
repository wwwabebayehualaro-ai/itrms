/**
 * The demo's controlled stationery (task 1.12a): in each demo region deliveries from the regional bureau received at the
 * root, handed down and accepted level by level to the offices that use them, so a registration has libre booklets, a print
 * batch has card blanks, and a bolo has stickers of its category and year. Shaped on the reference zone's documents (the
 * bureau sells the zone its booklets and stickers; a bolo sticker is printed per category and year): serials and references
 * are generated. Written through the stock's own commands (audited, reconciled). Run again, it adds nothing: the first
 * delivery's reference is the marker (a run that stopped part-way is said so, never taken for done).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DbContext } from '@itrms/kernel/db';
import { orgUnits } from '@itrms/kernel/tables';

import type { StationeryKind, StationeryReceive } from '../contracts';
import type { StationeryStock } from '../api/stationery.service';
import { stationeryBatches, stationeryItems } from '../api/stationery.table';

interface Delivery {
    kind: StationeryKind;
    series: string;
    from: number;
    to: number;
    width: number;
    variant?: string;
    validEfy?: number;
    /** santim, from the bureau's price list as the zone sent it (demo) */
    unitCostSantim?: string;
}

/** The deliveries every demo region receives, and the share each office hands to the one below it (root first). */
const DELIVERIES: readonly Delivery[] = [
    { kind: 'libre_booklet', series: 'LB', from: 1, to: 200, width: 7, unitCostSantim: '13000' },
    { kind: 'licence_blank', series: 'LC', from: 1, to: 200, width: 7 },
    { kind: 'bolo_sticker', series: '', from: 3501, to: 3700, width: 7, variant: 'taxi', validEfy: 2018 },
    { kind: 'bolo_sticker', series: 'G', from: 251, to: 350, width: 7, variant: 'government', validEfy: 2018 },
    { kind: 'bolo_sticker', series: 'P', from: 1301, to: 1400, width: 7, variant: 'private', validEfy: 2018 },
    { kind: 'bolo_sticker', series: 'C', from: 1, to: 100, width: 7, variant: 'commercial', validEfy: 2018 },
    { kind: 'receipt_leaf', series: 'R', from: 1, to: 500, width: 6 }
];

export const DEMO_STATIONERY: Record<string, { chain: readonly [string, number][] }> = {
    // of every delivery: the zone takes 60 %, Boditi 30 % of it (counted from the first serial)
    SER: {
        chain: [
            ['WOL', 60],
            ['WOL-BODITI', 30]
        ]
    },
    SCA: { chain: [['SCA-NORTH', 50]] }
};

export interface StationeryDemoCounts {
    deliveries: number;
    items: number;
}

export async function importStationeryDemo(
    db: Database,
    code: string,
    stock: Pick<StationeryStock, 'receive' | 'allocate' | 'accept'>,
    today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date())
): Promise<StationeryDemoCounts | null> {
    const plan = DEMO_STATIONERY[code];
    if (!plan) throw new Error(`no demo stationery is planned for region ${code}`);
    const base = { requestId: 'seed:demo-stationery' };
    const referenceOf = (i: number) => `${code}-DEMO-ST-${String(i + 1).padStart(3, '0')}`;
    const { root, chain, seeded } = await db.scoped(base, async (tx) => {
        const [found] = await tx
            .select()
            .from(orgUnits)
            .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, code)));
        if (!found) throw new Error(`no region ${code}`);
        const units = await tx
            .select()
            .from(orgUnits)
            .where(
                and(
                    eq(orgUnits.regionId, found.regionId),
                    inArray(
                        orgUnits.code,
                        plan.chain.map(([c]) => c)
                    )
                )
            );
        const batches = await tx
            .select({ id: stationeryBatches.id, reference: stationeryBatches.reference })
            .from(stationeryBatches)
            .where(
                and(
                    eq(stationeryBatches.regionId, found.regionId),
                    inArray(
                        stationeryBatches.reference,
                        DELIVERIES.map((_, i) => referenceOf(i))
                    )
                )
            );
        const lastBatch = batches.find((b) => b.reference === referenceOf(DELIVERIES.length - 1));
        const last = units.find((u) => u.code === plan.chain[plan.chain.length - 1]?.[0]);
        const [held] =
            lastBatch && last
                ? await tx
                      .select({ id: stationeryItems.id })
                      .from(stationeryItems)
                      .where(and(eq(stationeryItems.batchId, lastBatch.id), eq(stationeryItems.holderUnitId, last.id)))
                      .limit(1)
                : [];
        if (batches.length > 0 && !held)
            throw new Error(`the demo stationery of ${code} is half-seeded (a run stopped part-way): run demo:reset`);
        return {
            root: found,
            seeded: batches.length > 0,
            chain: plan.chain.map(([wanted, share]) => {
                const unit = units.find((u) => u.code === wanted);
                if (!unit) throw new Error(`no unit ${wanted}`);
                return { unit, share };
            })
        };
    });
    if (seeded) return null;
    const as = (unit: { id: string; path: string }): DbContext => ({
        ...base,
        regionId: root.regionId,
        unitId: unit.id,
        scopePath: unit.path
    });
    let items = 0;
    for (const [i, d] of DELIVERIES.entries()) {
        let from = as(root);
        const receive: StationeryReceive = {
            kind: d.kind,
            source: 'regional_bureau',
            reference: referenceOf(i),
            receivedOn: today,
            range: { series: d.series, from: d.from, to: d.to },
            width: d.width,
            ...(d.variant ? { variant: d.variant } : {}),
            ...(d.validEfy ? { validEfy: d.validEfy } : {}),
            ...(d.unitCostSantim ? { unitCostSantim: d.unitCostSantim } : {}),
            note: 'Demo delivery (generated)'
        };
        const given = from;
        await db.scoped(given, (tx) => stock.receive(tx, given, receive));
        items += d.to - d.from + 1;
        const total = d.to - d.from + 1;
        for (const { unit, share } of chain) {
            const n = Math.max(1, Math.floor((total * share) / 100));
            const giver = from;
            const sent = await db.scoped(giver, (tx) =>
                stock.allocate(tx, giver, {
                    kind: d.kind,
                    toUnitId: unit.id,
                    items: { series: d.series, from: d.from, to: d.from + n - 1 }
                })
            );
            const taker = as(unit);
            await db.scoped(taker, (tx) => stock.accept(tx, taker, sent.id, {}));
            from = taker;
        }
    }
    return { deliveries: DELIVERIES.length, items };
}
