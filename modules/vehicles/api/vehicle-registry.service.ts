/**
 * The register's commands (task 1.1a): register a vehicle with its first owners, transfer it, record a plate or a libre, take
 * it off the register. There is no HTTP endpoint for them: the registry tables change only through case effects (roles-and-
 * permissions.md §2), the seeds and the tests, all of which call this service inside their own transaction
 * (`db.scoped(ctx, tx => registry.transferOwnership(tx, ctx, …))`), so the audit rows are in that transaction and a rolled-back
 * command leaves nothing.
 *
 * A vehicle's ownership periods have no gap and no overlap and exactly one is open while it is active; a deferred constraint
 * trigger in the migration checks that at commit, whatever writes the rows. These commands keep it by construction: a
 * transfer ends the open period on the day the next begins.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { insertAudited, newId, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { nextNumber } from '@itrms/kernel/numbering';
import { OrganisationsService, PersonsService } from '@itrms/parties/api';
import type { z } from 'zod';

import {
    LIBRE_COUNTER,
    parsePlate,
    parseVin,
    vehicleSearchKey,
    libreRecordSchema,
    ownershipTransferSchema,
    plateRecordSchema,
    statusChangeSchema,
    vehicleRegisterSchema,
    type ChassisKind,
    type PlateRecord,
    type VinCheck
} from '../contracts';
import { checked, fieldError, guardUnique, notFuture, required, unitRefs, withinScope } from './support';
import {
    libres,
    plateAssignments,
    vehicleCategories,
    vehicleOwners,
    vehicleOwnerships,
    vehicles
} from './vehicles.table';
import { PlateStock } from './plate-stock.service';
import { VehiclesService } from './vehicles.service';

export type VehicleRow = typeof vehicles.$inferSelect;
type OwnerRef = z.infer<typeof ownershipTransferSchema>['owners'][number];

const DUPLICATES = {
    vehicles_federal_id_uq: 'vehicles.errors.duplicate_federal_id',
    vehicles_vin_uq: 'vehicles.errors.duplicate_chassis',
    plate_assignments_open_plate_uq: 'vehicles.errors.duplicate_plate',
    libres_number_uq: 'vehicles.errors.duplicate_libre'
};

@Injectable()
export class VehicleRegistry {
    constructor(
        @Inject(PersonsService) private readonly persons: PersonsService,
        @Inject(OrganisationsService) private readonly organisations: OrganisationsService,
        // only the region's old plate codes: a seed gives them without the settings service
        @Inject(VehiclesService) private readonly reads: Pick<VehiclesService, 'legacyRegions'>,
        @Inject(PlateStock) private readonly stock: PlateStock
    ) {}

    /**
     * What registering `given` would check, without writing: the category, the fit of seats, load and axles, the chassis number
     * (and that it is not already on the register in the region), the dates and the owners. A case's form calls it before the
     * officer submits; `register` calls it again.
     */
    async checkRegistration(
        tx: Tx,
        ctx: DbContext,
        given: z.input<typeof vehicleRegisterSchema>
    ): Promise<{ vinKey: string; chassisNumber: string; vinCheck: VinCheck; chassisKind: ChassisKind }> {
        const input = checked(vehicleRegisterSchema, given);
        const regionId = required(ctx.regionId);
        const [category] = await tx
            .select()
            .from(vehicleCategories)
            .where(and(eq(vehicleCategories.regionId, regionId), eq(vehicleCategories.key, input.categoryKey)));
        if (!category?.active) throw fieldError('categoryKey', 'unknown_category', 'is not a vehicle category here');
        if (category.needsSeats !== (input.seats !== undefined))
            throw fieldError('seats', category.needsSeats ? 'required' : 'not_allowed', 'does not fit the category');
        if (category.needsLoad !== (input.loadCapacityKg !== undefined))
            throw fieldError(
                'loadCapacityKg',
                category.needsLoad ? 'required' : 'not_allowed',
                'does not fit the category'
            );
        if (category.family === 'freight' && input.axles === undefined)
            throw fieldError('axles', 'required', 'a freight vehicle has axles');

        const vin = parseVin(input.chassisNumber, {
            chassisKind: input.chassisKind,
            modelYear: input.modelYear,
            acceptMismatch: input.acceptVinMismatch
        });
        if (!vin.ok) throw fieldError('chassisNumber', vin.code, vin.problem);
        notFuture('firstRegisteredOn', input.firstRegisteredOn);
        const since = input.since ?? input.firstRegisteredOn;
        notFuture('since', since);
        if (since < input.firstRegisteredOn)
            throw fieldError('since', 'before_registration', 'is before the first registration');
        await this.checkOwners(tx, input.owners, 'owners');
        const [onRegister] = await tx
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(and(eq(vehicles.regionId, regionId), eq(vehicles.vinKey, vin.vinKey)));
        if (onRegister)
            throw new ConflictError('duplicate_reference', { detailKey: 'vehicles.errors.duplicate_chassis' });
        return {
            vinKey: vin.vinKey,
            chassisNumber: vin.chassisNumber,
            vinCheck: vin.vinCheck,
            chassisKind: vin.chassisKind
        };
    }

    /** Registers a vehicle, handled by the acting unit, with its first ownership period and holders. */
    async register(tx: Tx, ctx: DbContext, given: z.input<typeof vehicleRegisterSchema>): Promise<VehicleRow> {
        const input = checked(vehicleRegisterSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        const { vinKey, chassisNumber, vinCheck, chassisKind } = await this.checkRegistration(tx, ctx, given);
        const [category] = await tx
            .select()
            .from(vehicleCategories)
            .where(and(eq(vehicleCategories.regionId, regionId), eq(vehicleCategories.key, input.categoryKey)));
        if (!category) throw new NotFoundError();
        const since = input.since ?? input.firstRegisteredOn;

        const id = newId();
        await guardUnique(async () => {
            await insertAudited(tx, vehicles, {
                id,
                regionId,
                handlingUnitId: unitId,
                federalVehicleId: input.federalVehicleId ?? null,
                federalIdSource: input.federalIdSource ?? null,
                chassisNumber,
                chassisKind,
                vinKey,
                vinCheck,
                engineNumber: input.engineNumber ?? null,
                engineKey: input.engineNumber ? vehicleSearchKey(input.engineNumber) : null,
                make: input.make,
                model: input.model,
                modelYear: input.modelYear,
                categoryId: category.id,
                use: input.use,
                seats: input.seats ?? null,
                loadCapacityKg: input.loadCapacityKg ?? null,
                grossWeightKg: input.grossWeightKg ?? null,
                engineCc: input.engineCc ?? null,
                axles: input.axles ?? null,
                colour: input.colour ?? null,
                fuel: input.fuel ?? null,
                firstRegisteredOn: input.firstRegisteredOn
            });
        }, DUPLICATES);
        await this.openOwnership(tx, id, {
            since,
            owners: input.owners,
            acquiredBy: input.acquiredBy,
            caseId: input.caseId,
            note: input.note
        });
        const [row] = await tx.select().from(vehicles).where(eq(vehicles.id, id));
        if (!row) throw new NotFoundError();
        return row;
    }

    /** Ends the open ownership period on the day the new holders' begins. `version` is the vehicle's, as the caller read it. */
    async transferOwnership(
        tx: Tx,
        ctx: DbContext,
        vehicleId: string,
        version: number,
        given: z.input<typeof ownershipTransferSchema>
    ): Promise<VehicleRow> {
        const input = checked(ownershipTransferSchema, given);
        const vehicle = await this.lock(tx, ctx, vehicleId, version);
        if (vehicle.status !== 'active')
            throw new ConflictError('invalid_transition', {
                detailKey: 'vehicles.errors.not_on_register'
            });
        notFuture('since', input.since);
        const open = await this.openPeriod(tx, vehicleId);
        if (input.since <= open.since)
            throw fieldError('since', 'before_period', 'is not after the current owners took it');
        await this.checkOwners(tx, input.owners, 'owners');
        await updateAudited(tx, vehicleOwnerships, open.id, open.rowVersion, { until: input.since });
        await this.openOwnership(tx, vehicleId, input);
        return updateAudited(tx, vehicles, vehicleId, version, {});
    }

    /**
     * Records the plate a vehicle now carries: the current one ends the same day, for `endedReason`. The same plate on
     * another vehicle is a 409; a text that is no plate is a 422.
     */
    async recordPlate(
        tx: Tx,
        ctx: DbContext,
        vehicleId: string,
        given: z.input<typeof plateRecordSchema>,
        version?: number
    ): Promise<void> {
        const input = checked(plateRecordSchema, given);
        const vehicle = await this.lock(tx, ctx, vehicleId, version);
        const parsed = parsePlate(input.text, await this.reads.legacyRegions(tx));
        if (!parsed) throw fieldError('text', 'invalid_plate', 'is not a plate');
        // a plate of the stock is issued from it (assignStockPlate), never typed in
        if (parsed.format === 'national' && (await this.stock.inStock(tx, vehicle.regionId, parsed.key)))
            throw new ConflictError('duplicate_reference', { detailKey: 'vehicles.errors.plate_in_stock' });
        await this.openPlate(tx, ctx, vehicle, parsed, input, null);
    }

    /**
     * A plate of the acting office's stock put on the vehicle (task 1.2a): the one named, or the office's next free one; the
     * plate the vehicle carried ends the same day, for `endedReason`. What a registration (1.2b) and an exchange (1.2c) call.
     */
    async assignStockPlate(
        tx: Tx,
        ctx: DbContext,
        vehicleId: string,
        wanted: { key?: string; caseId?: string; since: string; endedReason?: PlateRecord['endedReason'] },
        version?: number
    ): Promise<{ plateId: string; key: string }> {
        const vehicle = await this.lock(tx, ctx, vehicleId, version);
        // the plate comes from the stock of the office that handles the vehicle, which later retires it with the vehicle
        if (vehicle.handlingUnitId !== ctx.unitId)
            throw new ForbiddenError({ detailKey: 'vehicles.errors.other_office' });
        notFuture('since', wanted.since);
        const plate = await this.stock.take(tx, ctx, {
            key: wanted.key,
            vehicleId,
            caseId: wanted.caseId,
            on: wanted.since
        });
        const parsed = parsePlate(plate.plateKey, []);
        if (!parsed) throw new NotFoundError();
        await this.openPlate(
            tx,
            ctx,
            vehicle,
            parsed,
            { source: 'federal', since: wanted.since, endedReason: wanted.endedReason ?? 'exchanged' },
            plate.id
        );
        return { plateId: plate.id, key: plate.plateKey };
    }

    /** The vehicle carries `parsed` from `input.since`; the plate it carried ends then (and leaves the stock for good). */
    private async openPlate(
        tx: Tx,
        ctx: DbContext,
        vehicle: VehicleRow,
        parsed: NonNullable<ReturnType<typeof parsePlate>>,
        input: { source: PlateRecord['source']; since: string; endedReason: PlateRecord['endedReason'] },
        plateId: string | null
    ): Promise<void> {
        if (vehicle.status !== 'active' && vehicle.status !== 'stolen')
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.not_on_register' });
        notFuture('since', input.since);
        if (input.since < vehicle.firstRegisteredOn)
            throw fieldError('since', 'before_registration', 'is before the first registration');
        const [current] = await tx
            .select()
            .from(plateAssignments)
            .where(and(eq(plateAssignments.vehicleId, vehicle.id), isNull(plateAssignments.until)));
        const [ended] = await tx
            .select({ until: sql<string | null>`max(${plateAssignments.until})` })
            .from(plateAssignments)
            .where(eq(plateAssignments.vehicleId, vehicle.id));
        if (ended?.until && input.since < ended.until)
            throw fieldError('since', 'before_period', 'is before the previous plate ended');
        if (current) {
            if (current.plateKey === parsed.key)
                throw new ConflictError('duplicate_reference', { detailKey: 'vehicles.errors.plate_already_carried' });
            if (input.since < current.since) throw fieldError('since', 'before_period', 'is before the current plate');
            await updateAudited(tx, plateAssignments, current.id, current.rowVersion, {
                until: input.since,
                endedReason: input.endedReason
            });
            if (current.plateId)
                await this.stock.closeAssigned(tx, ctx, current.plateId, {
                    status: input.endedReason === 'lost' ? 'lost' : 'retired',
                    endReason: input.endedReason,
                    on: input.since
                });
        }
        await guardUnique(
            () =>
                insertAudited(tx, plateAssignments, {
                    regionId: vehicle.regionId,
                    handlingUnitId: vehicle.handlingUnitId,
                    vehicleId: vehicle.id,
                    plateText: parsed.text,
                    plateKey: parsed.key,
                    format: parsed.format,
                    legacyUseCode: parsed.useCode,
                    legacyRegionCode: parsed.regionCode,
                    source: input.source,
                    since: input.since,
                    plateId
                }),
            DUPLICATES
        );
        // a new version of the vehicle: a caller holding the one before this plate cannot act on it unseen
        await updateAudited(tx, vehicles, vehicle.id, vehicle.rowVersion, {});
    }

    /** Records the libre issued for the vehicle's current owners; the one in force is replaced. */
    async recordLibre(
        tx: Tx,
        ctx: DbContext,
        vehicleId: string,
        given: z.input<typeof libreRecordSchema>,
        version?: number
    ): Promise<void> {
        const input = checked(libreRecordSchema, given);
        const vehicle = await this.lock(tx, ctx, vehicleId, version);
        if (vehicle.status !== 'active')
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.not_on_register' });
        notFuture('issuedOn', input.issuedOn);
        const open = await this.openPeriod(tx, vehicleId);
        if (input.issuedOn < open.since)
            throw fieldError('issuedOn', 'before_period', 'is before the current owners took it');
        const issuingUnitId = input.issuingUnitId ?? required(ctx.unitId);
        if (!(await unitRefs(tx, [issuingUnitId])).has(issuingUnitId))
            throw fieldError('issuingUnitId', 'unknown_unit', 'is not a unit of this region');
        const [current] = await tx
            .select()
            .from(libres)
            .where(and(eq(libres.vehicleId, vehicleId), eq(libres.status, 'issued')));
        if (current) await updateAudited(tx, libres, current.id, current.rowVersion, { status: 'replaced' });
        await guardUnique(
            () =>
                insertAudited(tx, libres, {
                    regionId: vehicle.regionId,
                    handlingUnitId: vehicle.handlingUnitId,
                    vehicleId,
                    ownershipId: open.id,
                    number: input.number ?? null,
                    issuedOn: input.issuedOn,
                    issuingUnitId,
                    replacesId: current?.id ?? null,
                    nationalReference: input.nationalReference ?? null,
                    caseId: input.caseId ?? null
                }),
            DUPLICATES
        );
        await updateAudited(tx, vehicles, vehicleId, vehicle.rowVersion, {});
    }

    /**
     * The libre of a case for the vehicle's current owners, numbered from the handling office's counter. Asked again for the
     * same case it returns the libre it issued, so a retried effect issues one libre and takes one number.
     */
    async issueLibre(
        tx: Tx,
        ctx: DbContext,
        vehicleId: string,
        given: { issuedOn: string; caseId: string }
    ): Promise<typeof libres.$inferSelect> {
        const [issued] = await tx
            .select()
            .from(libres)
            .where(and(eq(libres.vehicleId, vehicleId), eq(libres.caseId, given.caseId)));
        if (issued) return issued;
        const vehicle = await this.lock(tx, ctx, vehicleId);
        const { number } = await nextNumber(tx, LIBRE_COUNTER, vehicle.handlingUnitId);
        await this.recordLibre(tx, ctx, vehicleId, { issuedOn: given.issuedOn, number, caseId: given.caseId });
        const [libre] = await tx
            .select()
            .from(libres)
            .where(and(eq(libres.vehicleId, vehicleId), eq(libres.caseId, given.caseId)));
        if (!libre) throw new NotFoundError();
        return libre;
    }

    /**
     * Takes a vehicle off the register: transferred out of the region or deregistered (the open ownership period, the plate
     * and the libre end that day), or reported stolen (it stays the owners' and keeps its plate and libre; `restore` brings
     * it back). Reactivating a transferred-out vehicle is planned for task 1.4.
     */
    async setStatus(
        tx: Tx,
        ctx: DbContext,
        vehicleId: string,
        version: number,
        given: z.input<typeof statusChangeSchema>
    ): Promise<VehicleRow> {
        const input = checked(statusChangeSchema, given);
        const vehicle = await this.lock(tx, ctx, vehicleId, version);
        if (vehicle.status !== 'active')
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.not_on_register' });
        notFuture('on', input.on);
        if (input.status !== 'stolen') {
            const open = await this.openPeriod(tx, vehicleId);
            if (input.on <= open.since)
                throw fieldError('on', 'before_period', 'is not after the current owners took it');
            await updateAudited(tx, vehicleOwnerships, open.id, open.rowVersion, { until: input.on });
            const [plate] = await tx
                .select()
                .from(plateAssignments)
                .where(and(eq(plateAssignments.vehicleId, vehicleId), isNull(plateAssignments.until)));
            if (plate) {
                const endedReason = input.status === 'transferred_out' ? 'transferred' : 'retired';
                const until = input.on < plate.since ? plate.since : input.on;
                await updateAudited(tx, plateAssignments, plate.id, plate.rowVersion, { until, endedReason });
                if (plate.plateId)
                    await this.stock.closeAssigned(tx, ctx, plate.plateId, {
                        status: 'retired',
                        endReason: endedReason,
                        on: until
                    });
            }
            const [libre] = await tx
                .select()
                .from(libres)
                .where(and(eq(libres.vehicleId, vehicleId), eq(libres.status, 'issued')));
            if (libre) await updateAudited(tx, libres, libre.id, libre.rowVersion, { status: 'cancelled' });
        }
        return updateAudited(tx, vehicles, vehicleId, version, { status: input.status });
    }

    /** A vehicle reported stolen is found: it is active again, with the owners it had. */
    async restore(tx: Tx, ctx: DbContext, vehicleId: string, version: number): Promise<VehicleRow> {
        const vehicle = await this.lock(tx, ctx, vehicleId, version);
        if (vehicle.status !== 'stolen')
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.not_stolen' });
        return updateAudited(tx, vehicles, vehicleId, version, { status: 'active' });
    }

    /** The vehicle, locked for this transaction, if the caller's unit handles it and `version` is still current. */
    private async lock(tx: Tx, ctx: DbContext, id: string, version?: number): Promise<VehicleRow> {
        // the region reads every vehicle; a row-level lock needs the right to update it, so the scope is checked on a plain
        // read first (another office's vehicle is a 403, not a missing row)
        const [seen] = await tx.select().from(vehicles).where(eq(vehicles.id, id));
        if (!seen) throw new NotFoundError();
        if (!withinScope(seen.handlingOrgPath, ctx.scopePath ?? ''))
            throw new ForbiddenError({ detailKey: 'vehicles.errors.other_office' });
        const [row] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for('update');
        if (!row) throw new NotFoundError();
        if (version !== undefined && row.rowVersion !== version)
            throw new ConflictError('stale_version', {
                detailKey: 'vehicles.errors.stale_version',
                params: { expected: version, current: row.rowVersion }
            });
        return row;
    }

    private async openPeriod(tx: Tx, vehicleId: string) {
        const [open] = await tx
            .select()
            .from(vehicleOwnerships)
            .where(and(eq(vehicleOwnerships.vehicleId, vehicleId), isNull(vehicleOwnerships.until)));
        if (!open) throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.no_owners' });
        return open;
    }

    /** Every holder exists in the region (RLS) and a person was not merged into another. */
    private async checkOwners(tx: Tx, owners: readonly OwnerRef[], path: string): Promise<void> {
        const personIds = owners.filter((o) => o.kind === 'person').map((o) => o.id);
        const organisationIds = owners.filter((o) => o.kind === 'organisation').map((o) => o.id);
        const people = new Map((await this.persons.summaries(tx, personIds)).map((p) => [p.id, p]));
        const organisations = new Set((await this.organisations.summaries(tx, organisationIds)).map((o) => o.id));
        owners.forEach((owner, i) => {
            const found =
                owner.kind === 'person' ? people.get(owner.id)?.status === 'active' : organisations.has(owner.id);
            if (!found) throw fieldError(`${path}.${i}.id`, 'unknown_owner', 'is not on the register');
        });
    }

    private async openOwnership(
        tx: Tx,
        vehicleId: string,
        input: Pick<z.infer<typeof ownershipTransferSchema>, 'since' | 'owners' | 'note' | 'caseId'> & {
            acquiredBy: z.infer<typeof ownershipTransferSchema>['acquiredBy'] | 'first_registration';
        }
    ): Promise<void> {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId));
        if (!vehicle) throw new NotFoundError();
        const ownershipId = newId();
        await insertAudited(tx, vehicleOwnerships, {
            id: ownershipId,
            regionId: vehicle.regionId,
            handlingUnitId: vehicle.handlingUnitId,
            vehicleId,
            since: input.since,
            acquiredBy: input.acquiredBy,
            caseId: input.caseId ?? null,
            note: input.note ?? null
        });
        let ordinal = 0;
        for (const owner of input.owners) {
            ordinal += 1;
            await insertAudited(tx, vehicleOwners, {
                regionId: vehicle.regionId,
                handlingUnitId: vehicle.handlingUnitId,
                ownershipId,
                personId: owner.kind === 'person' ? owner.id : null,
                organisationId: owner.kind === 'organisation' ? owner.id : null,
                ordinal
            });
        }
    }
}
