/**
 * The document a vehicle arrived on from another region (task 1.4c3, ADR-0060): what the officer checked on the vehicle data
 * transfer document, written once with the registration that made the vehicle. There is no HTTP endpoint: the arrival service of
 * the competency slice calls it inside the step's transaction, so the audit row is in that transaction.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { insertAudited, recordEvent, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError } from '@itrms/kernel/errors';

import { arrivalKey, arrivalRecordSchema, type ArrivalRecord } from '../contracts';
import { TABLES } from './handover.service';
import { checked, guardUnique, notFuture, required } from './support';
import { vehicleArrivals, vehicleHandovers, vehicles } from './vehicles.table';

export type VehicleArrival = typeof vehicleArrivals.$inferSelect;

/** Whether the reviewed command refused a return by a check of its own (the case, the vehicle, the release), or by the caller's scope. */
function refusedReturn(error: unknown): boolean {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint } = e as { code?: string; constraint?: string };
        if (code === '23514' && constraint === 'handover_return_refused') return true;
        if (code === '42501') return true;
    }
    return false;
}

@Injectable()
export class VehicleArrivals {
    /** The arrival the case made, if it has: a step run twice makes one. */
    async ofCase(tx: Tx, caseId: string): Promise<VehicleArrival | undefined> {
        const [row] = await tx.select().from(vehicleArrivals).where(eq(vehicleArrivals.caseId, caseId));
        return row;
    }

    /** The arrival that used this document, if one did: a document number is used once per issuing region in the region. */
    async ofDocument(
        tx: Tx,
        regionId: string,
        document: { issuingRegion: string; number: string }
    ): Promise<VehicleArrival | undefined> {
        const [row] = await tx
            .select()
            .from(vehicleArrivals)
            .where(
                and(
                    eq(vehicleArrivals.regionId, regionId),
                    eq(vehicleArrivals.issuingRegionKey, arrivalKey(document.issuingRegion)),
                    eq(vehicleArrivals.documentKey, arrivalKey(document.number))
                )
            );
        return row;
    }

    /**
     * Records the document of the vehicle's arrival. Run again for the same case it returns the row it made. The document used by
     * another arrival is a 409.
     */
    async record(tx: Tx, ctx: DbContext, given: ArrivalRecord): Promise<VehicleArrival> {
        const input = checked(arrivalRecordSchema, given);
        const made = await this.ofCase(tx, input.caseId);
        if (made) return made;
        const regionId = required(ctx.regionId);
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicleId));
        if (!vehicle) throw new NotFoundError();
        notFuture('arrivedOn', input.arrivedOn);
        return guardUnique(
            () =>
                insertAudited(tx, vehicleArrivals, {
                    regionId,
                    handlingUnitId: vehicle.handlingUnitId,
                    vehicleId: vehicle.id,
                    caseId: input.caseId,
                    documentNumber: input.documentNumber,
                    documentKey: arrivalKey(input.documentNumber),
                    issuingRegion: input.issuingRegion,
                    issuingRegionKey: arrivalKey(input.issuingRegion),
                    issuingOffice: input.issuingOffice,
                    documentDate: input.documentDate,
                    validUntil: input.validUntil,
                    verifiedHow: input.verifiedHow,
                    arrivedOn: input.arrivedOn,
                    carriedPlateText: input.carriedPlateText ?? null,
                    carriedPlateKey: input.carriedPlateKey ?? null,
                    boloValidUntil: input.boloValidUntil ?? null,
                    holdsListed: input.holdsListed,
                    holdsNote: input.holdsNote ?? null,
                    returned: input.returned,
                    handoverId: input.handoverId ?? null
                }),
            { vehicle_arrivals_document_uq: 'vehicles.errors.duplicate_arrival_document' }
        );
    }

    /**
     * The return of a vehicle that left the region (task 1.4c3b, ADR-0060): the reviewed command `vehicles.accept_return` (migration
     * 0090) brings its own record back, active, to the case's office, and ends the release it left on `returned`; each row it wrote is
     * audited here as an event of the move. Run again for the same case it moves nothing more.
     */
    async acceptReturn(tx: Tx, caseId: string): Promise<{ moved: number }> {
        let rows: { tbl: string; row_id: string }[];
        try {
            ({ rows } = await tx.execute<{ tbl: string; row_id: string }>(
                sql`select tbl, row_id from vehicles.accept_return(${caseId}::uuid)`
            ));
        } catch (error) {
            if (!refusedReturn(error)) throw error;
            throw new ConflictError('invalid_transition', {
                detailKey: 'vehicles.errors.handover_return_refused',
                cause: error
            });
        }
        const [handover] = await tx.select().from(vehicleHandovers).where(eq(vehicleHandovers.inCaseId, caseId));
        for (const row of rows)
            await recordEvent(tx, {
                type: 'vehicles.returned',
                table: TABLES[row.tbl],
                rowId: row.row_id,
                data: { handoverId: handover?.id, caseId }
            });
        return { moved: rows.length };
    }
}
