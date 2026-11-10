/**
 * The demo's plate stock (task 1.2a): in each demo region a federal delivery received at the root, handed down and
 * accepted level by level to the offices that register vehicles, so a registration (1.2b) or a plate exchange (1.2c) has
 * plates to issue. Series starting with Q, which the demo's generated vehicles never carry. Written through the stock's own
 * commands (audited, reconciled). Run again, it adds nothing: the delivery's reference is the marker (a run that stopped
 * part-way is said so, never taken for done).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DbContext } from '@itrms/kernel/db';
import { orgUnits } from '@itrms/kernel/tables';

import type { PlateStock } from '../api/plate-stock.service';
import { plateBatches, plates } from '../api/vehicles.table';

/** Per demo region: the series delivered, and the plates each office hands to the one below it (root first). */
export const DEMO_PLATE_STOCK: Record<
    string,
    { series: string; delivered: number; chain: readonly [string, number][] }
> = {
    SER: {
        series: 'QSA',
        delivered: 500,
        chain: [
            ['WOL', 300],
            ['WOL-BODITI', 150]
        ]
    },
    SCA: { series: 'QSA', delivered: 300, chain: [['SCA-NORTH', 150]] }
};

export interface PlateStockDemoCounts {
    received: number;
    allocated: number;
}

export async function importPlateStockDemo(
    db: Database,
    code: string,
    stock: Pick<PlateStock, 'receive' | 'allocate' | 'accept'>,
    today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date())
): Promise<PlateStockDemoCounts | null> {
    const plan = DEMO_PLATE_STOCK[code];
    if (!plan) throw new Error(`no demo plate stock is planned for region ${code}`);
    const base = { requestId: 'seed:demo-plate-stock' };
    const reference = `${code}-DEMO-DN-0001`;
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
        const [batch] = await tx
            .select({ id: plateBatches.id })
            .from(plateBatches)
            .where(and(eq(plateBatches.regionId, found.regionId), eq(plateBatches.reference, reference)));
        // the last office of the chain holding plates of the delivery: the seed went all the way
        const last = units.find((u) => u.code === plan.chain[plan.chain.length - 1]?.[0]);
        const [held] =
            batch && last
                ? await tx
                      .select({ id: plates.id })
                      .from(plates)
                      .where(and(eq(plates.batchId, batch.id), eq(plates.holderUnitId, last.id)))
                      .limit(1)
                : [];
        if (batch && !held)
            throw new Error(`the demo plate stock of ${code} is half-seeded (a run stopped part-way): run demo:reset`);
        return {
            root: found,
            seeded: batch !== undefined,
            chain: plan.chain.map(([wanted, n]) => {
                const unit = units.find((u) => u.code === wanted);
                if (!unit) throw new Error(`no unit ${wanted}`);
                return { unit, n };
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
    let allocated = 0;
    let from = as(root);
    await db.scoped(from, (tx) =>
        stock.receive(tx, from, {
            reference,
            receivedOn: today,
            plates: { series: plan.series, from: 1, to: plan.delivered },
            note: 'Demo delivery (generated)'
        })
    );
    for (const { unit, n } of chain) {
        const giver = from;
        const sent = await db.scoped(giver, (tx) =>
            stock.allocate(tx, giver, { toUnitId: unit.id, plates: { series: plan.series, from: 1, to: n } })
        );
        const taker = as(unit);
        await db.scoped(taker, (tx) => stock.accept(tx, taker, sent.id, {}));
        allocated += n;
        from = taker;
    }
    return { received: plan.delivered, allocated };
}
