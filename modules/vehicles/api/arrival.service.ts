/**
 * The document a vehicle arrived on from another region (task 1.4c3, ADR-0060): what the officer checked on the vehicle data
 * transfer document, written once with the registration that made the vehicle. There is no HTTP endpoint: the arrival service of
 * the competency slice calls it inside the step's transaction, so the audit row is in that transaction.
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { insertAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';

import { arrivalKey, arrivalRecordSchema, type ArrivalRecord } from '../contracts';
import { checked, guardUnique, notFuture, required } from './support';
import { vehicleArrivals, vehicles } from './vehicles.table';

export type VehicleArrival = typeof vehicleArrivals.$inferSelect;

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
                    holdsNote: input.holdsNote ?? null
                }),
            { vehicle_arrivals_document_uq: 'vehicles.errors.duplicate_arrival_document' }
        );
    }
}
