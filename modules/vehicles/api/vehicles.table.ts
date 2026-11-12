/**
 * The vehicle register (architecture.md §6.1, ADR-0013, task 1.1a). Regional records (class R): the whole region reads
 * them, the handling unit's subtree writes them, and a transfer changes the handling unit, never copies the vehicle.
 *
 *   vehicle_categories   the catalogue of kinds of vehicle (class C at the region's root).
 *   vehicles             one row per vehicle: the national (federal) id when there is one, the chassis number and its
 *                        search key (vin_key), engine, make, model, category, use, status; for a vehicle migrated from
 *                        paper, its source, paper reference, capturing case and verifier (ADR-0054).
 *   vehicle_ownerships   the history of who held the vehicle: periods with no gap and no overlap, one open while it is
 *                        active (a deferred constraint trigger in the migration checks that at commit).
 *   vehicle_owners       the holders of a period: a person or an organisation, one or more.
 *   plate_assignments    the plates the vehicle carried, the current one has no `until`; old ones stay searchable.
 *   libres               the libre of an ownership period: the federal booklet it is written in, by its serial (ADR-0050).
 *   plate_batches        the deliveries of national plates from the federal source (class T of the receiving unit).
 *   plates               the stock: one row per national plate, held by a unit, in a status (class R of the holder,
 *                        task 1.2a); a transition trigger and a deferred match with plate_assignments are in the migration.
 *   plate_movements      the ledger of the stock: receipts, allocations down the tree and their acceptance, recalls,
 *                        assignments, retirements and write-offs (class T of the lower unit; insert-only).
 *
 * The four child tables carry the vehicle's region and handling unit, copied from the vehicle by a trigger in the migration
 * (a unit cannot write a child row for a vehicle it does not handle). The foreign keys to the people register, the checks
 * of the dates, the exclusion constraint on the periods, the grants, the policies and the search function are in the
 * migration: this file is read by drizzle-kit, which can't load another slice's NestJS entry.
 */
import { sql } from 'drizzle-orm';
import {
    boolean,
    check,
    date,
    index,
    integer,
    jsonb,
    pgSchema,
    smallint,
    text,
    timestamp,
    uniqueIndex,
    uuid
} from 'drizzle-orm/pg-core';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';
import { orgUnits } from '@itrms/kernel/tables';
import type { I18nText } from '@itrms/schemas';

import {
    ACQUIRED_BY,
    CATEGORY_FAMILIES,
    CHASSIS_KINDS,
    FEDERAL_ID_SOURCES,
    FUELS,
    LIBRE_STATUSES,
    MIGRATION_SOURCES,
    MOVEMENT_KINDS,
    PLATE_END_REASONS,
    PLATE_ENDED_REASONS,
    PLATE_FORMATS,
    PLATE_STATUSES,
    PLATE_SOURCES,
    VEHICLE_STATUSES,
    VEHICLE_USES,
    VIN_CHECKS
} from '../contracts';

export const vehiclesSchema = pgSchema('vehicles');

const oneOf = (values: readonly string[]) => sql.raw(`(${values.map((v) => `'${v}'`).join(', ')})`);

const owned = () => ({
    regionId: uuid('region_id').notNull(),
    ownerUnitId: uuid('owner_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the owner unit */
    orgPath: ltree('org_path').notNull().default('')
});

const handling = () => ({
    regionId: uuid('region_id').notNull(),
    handlingUnitId: uuid('handling_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the handling unit */
    handlingOrgPath: ltree('handling_org_path').notNull().default('')
});

export const vehicleCategories = withRls(
    audited(
        vehiclesSchema.table(
            'vehicle_categories',
            {
                ...baseColumns(),
                ...owned(),
                key: text('key').notNull(),
                /** I18nText: Amharic and English required */
                name: jsonb('name').$type<I18nText>().notNull(),
                family: text('family', { enum: CATEGORY_FAMILIES }).notNull(),
                needsSeats: boolean('needs_seats').notNull().default(false),
                needsLoad: boolean('needs_load').notNull().default(false),
                active: boolean('active').notNull().default(true)
            },
            (t) => [
                uniqueIndex('vehicle_categories_key_uq').on(t.regionId, t.key),
                index('vehicle_categories_org_path_gist').using('gist', t.orgPath),
                check('vehicle_categories_key_check', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,39}$'`),
                check('vehicle_categories_family_check', sql`${t.family} in ${oneOf(CATEGORY_FAMILIES)}`),
                check(
                    'vehicle_categories_name_check',
                    sql`jsonb_typeof(${t.name}) = 'object' AND ${t.name} ? 'am' AND ${t.name} ? 'en' AND pg_column_size(${t.name}) <= 4096`
                )
            ]
        )
    ),
    'config'
);

export const vehicles = withRls(
    audited(
        vehiclesSchema.table(
            'vehicles',
            {
                ...baseColumns(),
                ...handling(),
                /** the national system's id (Directive 1050/2025); where it is the system of record, only its reference is kept */
                federalVehicleId: text('federal_vehicle_id'),
                federalIdSource: text('federal_id_source', { enum: FEDERAL_ID_SOURCES }),
                chassisNumber: text('chassis_number').notNull(),
                chassisKind: text('chassis_kind', { enum: CHASSIS_KINDS }).notNull(),
                /** the chassis number in its search form (upper case, letters and digits, I as 1, O and Q as 0) */
                vinKey: text('vin_key').notNull(),
                vinCheck: text('vin_check', { enum: VIN_CHECKS }).notNull(),
                engineNumber: text('engine_number'),
                engineKey: text('engine_key'),
                make: text('make').notNull(),
                model: text('model').notNull(),
                modelYear: integer('model_year').notNull(),
                categoryId: uuid('category_id')
                    .notNull()
                    .references(() => vehicleCategories.id),
                use: text('use', { enum: VEHICLE_USES }).notNull(),
                seats: integer('seats'),
                loadCapacityKg: integer('load_capacity_kg'),
                grossWeightKg: integer('gross_weight_kg'),
                engineCc: integer('engine_cc'),
                axles: integer('axles'),
                colour: text('colour'),
                fuel: text('fuel', { enum: FUELS }),
                /** the temporary libre's and the booklet's other facts (task 1.2d) */
                madeIn: text('made_in'),
                engineHp: integer('engine_hp'),
                cylinders: integer('cylinders'),
                lengthMm: integer('length_mm'),
                widthMm: integer('width_mm'),
                heightMm: integer('height_mm'),
                tyreSize: text('tyre_size'),
                tyres: integer('tyres'),
                netWeightKg: integer('net_weight_kg'),
                firstRegisteredOn: date('first_registered_on').notNull(),
                status: text('status', { enum: VEHICLE_STATUSES }).notNull().default('active'),
                /**
                 * A vehicle migrated from its paper file (ADR-0054, task 1.13): how it came, the paper file's reference, the
                 * case that captured it and the second person who verified it. All null for a vehicle registered in ITRMS.
                 */
                migrationSource: text('migration_source', { enum: MIGRATION_SOURCES }),
                paperReference: text('paper_reference'),
                migrationCaseId: uuid('migration_case_id'),
                migrationVerifiedBy: uuid('migration_verified_by'),
                migrationVerifiedAt: timestamp('migration_verified_at', { withTimezone: true })
            },
            (t) => [
                uniqueIndex('vehicles_federal_id_uq')
                    .on(t.regionId, t.federalVehicleId)
                    .where(sql`${t.federalVehicleId} is not null`),
                uniqueIndex('vehicles_vin_uq').on(t.regionId, t.vinKey),
                index('vehicles_region_vin_idx').on(t.regionId, t.vinKey),
                index('vehicles_region_engine_idx').on(t.regionId, t.engineKey),
                index('vehicles_vin_trgm').using('gin', sql`${t.vinKey} gin_trgm_ops`),
                index('vehicles_engine_trgm').using('gin', sql`${t.engineKey} gin_trgm_ops`),
                index('vehicles_handling_gist').using('gist', t.handlingOrgPath),
                check('vehicles_federal_id_check', sql`${t.federalVehicleId} ~ '^[A-Z0-9-]{4,40}$'`),
                check(
                    'vehicles_federal_source_check',
                    sql`(${t.federalVehicleId} is null) = (${t.federalIdSource} is null)`
                ),
                check(
                    'vehicles_chassis_check',
                    sql`length(${t.chassisNumber}) between 4 and 30 and length(${t.vinKey}) >= 4`
                ),
                check('vehicles_model_year_check', sql`${t.modelYear} between 1900 and 2100`),
                check('vehicles_use_check', sql`${t.use} in ${oneOf(VEHICLE_USES)}`),
                check('vehicles_status_check', sql`${t.status} in ${oneOf(VEHICLE_STATUSES)}`),
                check('vehicles_fuel_check', sql`${t.fuel} in ${oneOf(FUELS)}`),
                check('vehicles_chassis_kind_check', sql`${t.chassisKind} in ${oneOf(CHASSIS_KINDS)}`),
                check('vehicles_vin_check_check', sql`${t.vinCheck} in ${oneOf(VIN_CHECKS)}`),
                check('vehicles_federal_source_enum_check', sql`${t.federalIdSource} in ${oneOf(FEDERAL_ID_SOURCES)}`),
                check(
                    'vehicles_figures_check',
                    sql`coalesce(${t.seats}, 1) > 0 and coalesce(${t.loadCapacityKg}, 1) > 0 and coalesce(${t.grossWeightKg}, 1) > 0
                        and coalesce(${t.engineCc}, 1) > 0 and coalesce(${t.axles}, 1) > 0`
                ),
                check(
                    'vehicles_details_check',
                    sql`coalesce(${t.engineHp}, 1) > 0 and coalesce(${t.cylinders}, 1) > 0 and coalesce(${t.lengthMm}, 1) > 0
                        and coalesce(${t.widthMm}, 1) > 0 and coalesce(${t.heightMm}, 1) > 0 and coalesce(${t.tyres}, 1) > 0
                        and coalesce(${t.netWeightKg}, 1) > 0 and coalesce(length(${t.madeIn}), 1) between 1 and 60
                        and coalesce(length(${t.tyreSize}), 1) between 1 and 20`
                ),
                check('vehicles_migration_source_check', sql`${t.migrationSource} in ${oneOf(MIGRATION_SOURCES)}`),
                check(
                    'vehicles_migration_check',
                    sql`(${t.migrationSource} is null) = (${t.paperReference} is null)
                        and coalesce(length(${t.paperReference}), 1) between 1 and 60
                        and (${t.migrationSource} is distinct from 'back_capture'
                             or (${t.migrationCaseId} is not null and ${t.migrationVerifiedBy} is not null
                                 and ${t.migrationVerifiedAt} is not null))
                        and (${t.migrationVerifiedBy} is null) = (${t.migrationVerifiedAt} is null)`
                ),
                check(
                    'vehicles_text_check',
                    sql`length(${t.make}) between 1 and 60 and length(${t.model}) between 1 and 60
                        and coalesce(length(${t.engineNumber}), 1) between 1 and 30 and coalesce(length(${t.colour}), 1) between 1 and 30`
                )
            ]
        )
    ),
    'registry'
);

export const vehicleOwnerships = withRls(
    audited(
        vehiclesSchema.table(
            'vehicle_ownerships',
            {
                ...baseColumns(),
                ...handling(),
                vehicleId: uuid('vehicle_id')
                    .notNull()
                    .references(() => vehicles.id),
                since: date('since').notNull(),
                /** the first day the previous holders no longer hold it; null while the period is open */
                until: date('until'),
                acquiredBy: text('acquired_by', { enum: ACQUIRED_BY }).notNull(),
                caseId: uuid('case_id'),
                note: text('note')
            },
            (t) => [
                index('vehicle_ownerships_vehicle_idx').on(t.vehicleId),
                // the target of the libres' composite foreign key: a libre's period is one of its own vehicle's
                uniqueIndex('vehicle_ownerships_id_vehicle_uq').on(t.id, t.vehicleId),
                // one open period per vehicle
                uniqueIndex('vehicle_ownerships_open_uq')
                    .on(t.vehicleId)
                    .where(sql`${t.until} is null`),
                index('vehicle_ownerships_handling_gist').using('gist', t.handlingOrgPath),
                check('vehicle_ownerships_dates_check', sql`${t.until} is null or ${t.until} > ${t.since}`),
                check('vehicle_ownerships_acquired_check', sql`${t.acquiredBy} in ${oneOf(ACQUIRED_BY)}`),
                check('vehicle_ownerships_note_check', sql`coalesce(length(${t.note}), 1) between 1 and 500`)
            ]
        )
    ),
    'registry'
);

export const vehicleOwners = withRls(
    audited(
        vehiclesSchema.table(
            'vehicle_owners',
            {
                ...baseColumns(),
                ...handling(),
                ownershipId: uuid('ownership_id')
                    .notNull()
                    .references(() => vehicleOwnerships.id),
                /** parties.persons (foreign key in the migration) */
                personId: uuid('person_id'),
                /** parties.organisations (foreign key in the migration) */
                organisationId: uuid('organisation_id'),
                ordinal: smallint('ordinal').notNull()
            },
            (t) => [
                uniqueIndex('vehicle_owners_ordinal_uq').on(t.ownershipId, t.ordinal),
                uniqueIndex('vehicle_owners_person_uq')
                    .on(t.ownershipId, t.personId)
                    .where(sql`${t.personId} is not null`),
                uniqueIndex('vehicle_owners_organisation_uq')
                    .on(t.ownershipId, t.organisationId)
                    .where(sql`${t.organisationId} is not null`),
                index('vehicle_owners_person_idx').on(t.personId),
                index('vehicle_owners_organisation_idx').on(t.organisationId),
                index('vehicle_owners_handling_gist').using('gist', t.handlingOrgPath),
                check(
                    'vehicle_owners_one_holder_check',
                    sql`(${t.personId} is not null)::int + (${t.organisationId} is not null)::int = 1`
                ),
                check('vehicle_owners_ordinal_check', sql`${t.ordinal} between 1 and 5`)
            ]
        )
    ),
    'registry'
);

export const plateAssignments = withRls(
    audited(
        vehiclesSchema.table(
            'plate_assignments',
            {
                ...baseColumns(),
                ...handling(),
                vehicleId: uuid('vehicle_id')
                    .notNull()
                    .references(() => vehicles.id),
                /** as written on the plate */
                plateText: text('plate_text').notNull(),
                /** the plate's key: upper case, letters and digits only (`ETHABC1234`) */
                plateKey: text('plate_key').notNull(),
                format: text('format', { enum: PLATE_FORMATS }).notNull(),
                legacyUseCode: smallint('legacy_use_code'),
                legacyRegionCode: text('legacy_region_code'),
                source: text('source', { enum: PLATE_SOURCES }).notNull(),
                since: date('since').notNull(),
                until: date('until'),
                endedReason: text('ended_reason', { enum: PLATE_ENDED_REASONS }),
                /** the stock plate, for a national plate issued from stock (task 1.2a); null for one back-captured */
                plateId: uuid('plate_id').references(() => plates.id)
            },
            (t) => [
                index('plate_assignments_vehicle_idx').on(t.vehicleId),
                // a stock plate is assigned once in its life
                uniqueIndex('plate_assignments_plate_uq')
                    .on(t.plateId)
                    .where(sql`${t.plateId} is not null`),
                check(
                    'plate_assignments_stock_check',
                    sql`${t.plateId} is null or (${t.format} = 'national' and ${t.source} = 'federal')`
                ),
                // a plate is carried by one vehicle at a time, and a vehicle carries one plate at a time
                uniqueIndex('plate_assignments_open_plate_uq')
                    .on(t.regionId, t.plateKey)
                    .where(sql`${t.until} is null`),
                uniqueIndex('plate_assignments_open_vehicle_uq')
                    .on(t.vehicleId)
                    .where(sql`${t.until} is null`),
                index('plate_assignments_region_key_idx').on(t.regionId, t.plateKey),
                index('plate_assignments_key_trgm').using('gin', sql`${t.plateKey} gin_trgm_ops`),
                index('plate_assignments_handling_gist').using('gist', t.handlingOrgPath),
                check('plate_assignments_format_check', sql`${t.format} in ${oneOf(PLATE_FORMATS)}`),
                check('plate_assignments_source_check', sql`${t.source} in ${oneOf(PLATE_SOURCES)}`),
                check('plate_assignments_reason_check', sql`${t.endedReason} in ${oneOf(PLATE_ENDED_REASONS)}`),
                check(
                    'plate_assignments_key_check',
                    sql`${t.plateKey} ~ '^[A-Z0-9]{3,40}$' and length(${t.plateText}) <= 60`
                ),
                check('plate_assignments_dates_check', sql`${t.until} is null or ${t.until} >= ${t.since}`),
                check('plate_assignments_ended_check', sql`(${t.until} is null) = (${t.endedReason} is null)`),
                check(
                    'plate_assignments_legacy_check',
                    sql`(${t.format} = 'legacy') = (${t.legacyUseCode} is not null) and (${t.legacyUseCode} is null or ${t.legacyUseCode} between 1 and 5)`
                )
            ]
        )
    ),
    'registry'
);

export const libres = withRls(
    audited(
        vehiclesSchema.table(
            'libres',
            {
                ...baseColumns(),
                ...handling(),
                vehicleId: uuid('vehicle_id')
                    .notNull()
                    .references(() => vehicles.id),
                ownershipId: uuid('ownership_id')
                    .notNull()
                    .references(() => vehicleOwnerships.id),
                /** the federal booklet's serial (ADR-0050): null until the booklet is issued (the temporary libre stands meanwhile) */
                number: text('number'),
                issuedOn: date('issued_on').notNull(),
                issuingUnitId: uuid('issuing_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                status: text('status', { enum: LIBRE_STATUSES }).notNull().default('issued'),
                replacesId: uuid('replaces_id'),
                nationalReference: text('national_reference'),
                caseId: uuid('case_id')
            },
            (t) => [
                index('libres_vehicle_idx').on(t.vehicleId),
                uniqueIndex('libres_number_uq')
                    .on(t.regionId, t.number)
                    .where(sql`${t.number} is not null`),
                // one libre in force per vehicle
                uniqueIndex('libres_issued_uq')
                    .on(t.vehicleId)
                    .where(sql`${t.status} = 'issued'`),
                index('libres_handling_gist').using('gist', t.handlingOrgPath),
                check('libres_status_check', sql`${t.status} in ${oneOf(LIBRE_STATUSES)}`),
                check(
                    'libres_text_check',
                    sql`coalesce(length(${t.number}), 1) between 1 and 40 and coalesce(length(${t.nationalReference}), 1) between 1 and 60`
                )
            ]
        )
    ),
    'registry'
);

/** A delivery of national plates from the federal source, as the receiving unit took it in. */
export const plateBatches = withRls(
    audited(
        vehiclesSchema.table(
            'plate_batches',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                receivingUnitId: uuid('receiving_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the receiving unit */
                orgPath: ltree('org_path').notNull().default(''),
                /** the federal dispatch or delivery-note number */
                reference: text('reference').notNull(),
                receivedOn: date('received_on').notNull(),
                quantity: integer('quantity').notNull(),
                firstKey: text('first_key').notNull(),
                lastKey: text('last_key').notNull(),
                note: text('note')
            },
            (t) => [
                uniqueIndex('plate_batches_reference_uq').on(t.regionId, t.reference),
                index('plate_batches_org_path_gist').using('gist', t.orgPath),
                check('plate_batches_quantity_check', sql`${t.quantity} between 1 and 10000`),
                check(
                    'plate_batches_text_check',
                    sql`length(${t.reference}) between 1 and 60 and coalesce(length(${t.note}), 0) <= 500`
                )
            ]
        )
    ),
    'transaction'
);

/** A national plate of the stock: who holds it and where it is in its life (contracts/plate-stock.ts). */
export const plates = withRls(
    audited(
        vehiclesSchema.table(
            'plates',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                holderUnitId: uuid('holder_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the holder unit */
                holderOrgPath: ltree('holder_org_path').notNull().default(''),
                batchId: uuid('batch_id')
                    .notNull()
                    .references(() => plateBatches.id),
                plateKey: text('plate_key').notNull(),
                series: text('series').notNull(),
                serial: smallint('serial').notNull(),
                status: text('status', { enum: PLATE_STATUSES }).notNull().default('in_stock'),
                statusOn: date('status_on').notNull(),
                vehicleId: uuid('vehicle_id').references(() => vehicles.id),
                caseId: uuid('case_id'),
                endReason: text('end_reason', { enum: PLATE_END_REASONS }),
                note: text('note'),
                /** the movement that last moved it (an allocation it waits on is how the unit below accepts it) */
                lastMovementId: uuid('last_movement_id')
            },
            (t) => [
                index('plates_last_movement_idx').on(t.lastMovementId),
                uniqueIndex('plates_key_uq').on(t.regionId, t.plateKey),
                uniqueIndex('plates_serial_uq').on(t.regionId, t.series, t.serial),
                // the next free plate of a unit, its counts and its runs
                index('plates_holder_status_idx').on(t.regionId, t.holderUnitId, t.status, t.series, t.serial),
                index('plates_holder_gist').using('gist', t.holderOrgPath),
                index('plates_batch_idx').on(t.batchId),
                index('plates_vehicle_idx').on(t.vehicleId),
                check('plates_status_check', sql`${t.status} in ${oneOf(PLATE_STATUSES)}`),
                check(
                    'plates_key_check',
                    sql`${t.series} ~ '^[A-Z]{3}$' and ${t.serial} between 0 and 9999 and ${t.plateKey} = 'ETH' || ${t.series} || lpad(${t.serial}::text, 4, '0')`
                ),
                check(
                    'plates_vehicle_check',
                    sql`(${t.status} in ('assigned', 'retired') and ${t.vehicleId} is not null) or (${t.status} in ('in_stock', 'allocated', 'reserved', 'void') and ${t.vehicleId} is null) or ${t.status} = 'lost'`
                ),
                check('plates_case_check', sql`${t.status} <> 'reserved' or ${t.caseId} is not null`),
                check(
                    'plates_end_check',
                    sql`(${t.endReason} is null) = (${t.status} not in ('retired', 'void', 'lost')) and (${t.endReason} is null or ${t.endReason} in ${oneOf(PLATE_END_REASONS)})`
                ),
                check('plates_note_check', sql`coalesce(length(${t.note}), 0) <= 500`)
            ]
        )
    ),
    'registry',
    'holder_org_path'
);

/** The ledger of the stock: one row per command, however many plates it moved. */
export const plateMovements = withRls(
    audited(
        vehiclesSchema.table(
            'plate_movements',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                /** the lower unit of the movement (the child of an allocation or a recall, else the holder) */
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                kind: text('kind', { enum: MOVEMENT_KINDS }).notNull(),
                fromUnitId: uuid('from_unit_id').references(() => orgUnits.id),
                toUnitId: uuid('to_unit_id').references(() => orgUnits.id),
                batchId: uuid('batch_id').references(() => plateBatches.id),
                /** an acceptance: the allocation it accepts */
                ofMovementId: uuid('of_movement_id'),
                quantity: integer('quantity').notNull(),
                firstKey: text('first_key').notNull(),
                lastKey: text('last_key').notNull(),
                /** an assignment, a retirement or a loss: the one plate, and its vehicle */
                plateId: uuid('plate_id').references(() => plates.id),
                vehicleId: uuid('vehicle_id').references(() => vehicles.id),
                caseId: uuid('case_id'),
                occurredOn: date('occurred_on').notNull(),
                reason: text('reason'),
                note: text('note')
            },
            (t) => [
                index('plate_movements_org_path_gist').using('gist', t.orgPath),
                index('plate_movements_unit_idx').on(t.regionId, t.unitId, t.kind),
                index('plate_movements_of_idx').on(t.ofMovementId),
                check('plate_movements_kind_check', sql`${t.kind} in ${oneOf(MOVEMENT_KINDS)}`),
                check('plate_movements_quantity_check', sql`${t.quantity} between 1 and 10000`),
                check(
                    'plate_movements_units_check',
                    sql`(${t.kind} in ('allocate', 'recall')) = (${t.fromUnitId} is not null and ${t.toUnitId} is not null)`
                ),
                check('plate_movements_batch_check', sql`(${t.kind} = 'receive') = (${t.batchId} is not null)`),
                check('plate_movements_accept_check', sql`(${t.kind} = 'accept') = (${t.ofMovementId} is not null)`),
                check(
                    'plate_movements_reason_check',
                    sql`(${t.kind} not in ('recall', 'write_off') or length(${t.reason}) >= 10) and coalesce(length(${t.reason}), 0) <= 500 and coalesce(length(${t.note}), 0) <= 500`
                )
            ]
        )
    ),
    'transaction'
);
