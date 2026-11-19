/**
 * The licence number a region gives (task 1.6, ADR-0051, ADR-0064 §2): one counter on the region's root unit, or each office's
 * own (scope `unit`). The number is taken in the worker (the system actor) when the national platform accepts and gives none of
 * its own. A request can't see the root's counter (class T, another unit), so the filing asks a reviewed definer that answers
 * only whether the caller's region has it.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { ConflictError } from '@itrms/kernel/errors';
import { nextNumber, requireCounter } from '@itrms/kernel/numbering';
import type { SettingsService } from '@itrms/kernel/settings';
import { orgUnits } from '@itrms/kernel/tables';

import {
    LICENCE_COUNTER,
    LICENCE_NUMBER_SETTING,
    LICENCE_NUMBERING_DEFAULT,
    licenceNumberingSchema,
    type LicenceNumbering
} from '../contracts';

/** The region's numbering as it stands for the unit (installation, then region; never an office's own). */
export async function licenceNumbering(
    settings: Pick<SettingsService, 'value'>,
    tx: Tx,
    unitId: string
): Promise<LicenceNumbering> {
    const parsed = licenceNumberingSchema.safeParse(await settings.value(tx, unitId, LICENCE_NUMBER_SETTING));
    return parsed.success ? parsed.data : LICENCE_NUMBERING_DEFAULT;
}

const notSetUp = () =>
    new ConflictError('not_configured', {
        detailKey: 'kernel.detail.no_number_series',
        params: { counter: LICENCE_COUNTER }
    });

/** The filing's check (409 `not_configured`): a licence filed now can be numbered when the platform accepts it. */
export async function requireLicenceSeries(tx: Tx, numbering: LicenceNumbering, unitId: string): Promise<void> {
    if (numbering.scope === 'unit') return requireCounter(tx, LICENCE_COUNTER, unitId);
    const { rows } = await tx.execute<{ ready: boolean }>(
        sql`select kernel.regional_counter_ready(${LICENCE_COUNTER}) as ready`
    );
    if (rows[0]?.ready !== true) throw notSetUp();
}

/**
 * The next number, in the activation's transaction: the root's counter row is locked until it commits, so activations across
 * the region queue and get consecutive numbers, and one that rolls back gives its number back.
 */
export async function takeLicenceNumber(
    tx: Tx,
    numbering: LicenceNumbering,
    place: { regionId: string; handlingUnitId: string }
): ReturnType<typeof nextNumber> {
    if (numbering.scope === 'unit') return nextNumber(tx, LICENCE_COUNTER, place.handlingUnitId);
    const [root] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.regionId, place.regionId), isNull(orgUnits.parentId)));
    if (!root) throw notSetUp();
    return nextNumber(tx, LICENCE_COUNTER, root.id);
}
