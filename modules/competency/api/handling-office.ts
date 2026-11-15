/**
 * Acting for a case's handling office (task 1.2e). A step of a vehicle service writes the office's records: the vehicle it handles,
 * a plate from its stock, a libre and a booklet from its stationery. The step is taken in the office, or in an office above it
 * when separation of duties left nobody in the office and the step was sent up the tree (SEC-AC-6): a one-officer office's
 * registration is then completed by the zone, for the office. Any other office is refused.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { ForbiddenError } from '@itrms/kernel/errors';

import type { CasePlace } from './licences.service';

/** Two vehicle requests open at once claim one vehicle: by its chassis key, an old plate's key, or the vehicle on the register. */
export type VehicleClaim = { vinKey?: string; plateKey?: string; vehicleId?: string };

/**
 * The case's place with the handling office as the acting unit, when the person acts from it or from an office above it. A case
 * the acting office cannot see is not one it may act in.
 */
export async function actForHandlingOffice(tx: Tx, place: CasePlace): Promise<CasePlace> {
    const acting = place.ctx.unitId;
    if (acting === place.handlingUnitId) return place;
    const { rows } = await tx.execute<{ above: boolean }>(sql`
        select h.path <@ a.path as above
          from kernel.org_units h, kernel.org_units a, workflow.cases c
         where h.id = ${place.handlingUnitId} and a.id = ${acting ?? null} and c.id = ${place.caseId}`);
    if (rows[0]?.above !== true) throw new ForbiddenError({ detailKey: 'competency.errors.act_from_handling_office' });
    return { ...place, ctx: { ...place.ctx, unitId: place.handlingUnitId } };
}

/**
 * Whether another open case of the region claims the vehicle: through the reviewed lookup (migration 0073), not the cases the
 * filer's office sees, so that two sibling offices cannot both take a fee and hold a plate for one vehicle.
 */
export async function claimedElsewhere(tx: Tx, caseId: string | null, claim: VehicleClaim): Promise<boolean> {
    const { rows } = await tx.execute<{ claimed: boolean }>(
        sql`select competency.vehicle_in_open_case(${claim.vinKey ?? null}, ${claim.plateKey ?? null},
                                                   ${claim.vehicleId ?? null}::uuid, ${caseId}::uuid) as claimed`
    );
    return rows[0]?.claimed === true;
}
