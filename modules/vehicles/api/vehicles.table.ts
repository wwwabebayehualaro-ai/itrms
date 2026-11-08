/**
 * The vehicle register (architecture.md §6.1, ADR-0013, task 1.1a). Regional records (class R): the whole region reads
 * them, the handling unit's subtree writes them, and a transfer changes the handling unit, never copies the vehicle.
 *
 *   vehicle_categories   the catalogue of kinds of vehicle (class C at the region's root).
 *   vehicles             one row per vehicle: the national (federal) id when there is one, the chassis number and its
 *                        search key (vin_key), engine, make, model, category, use, status.
 *   vehicle_ownerships   the history of who held the vehicle: periods with no gap and no overlap, one open while it is
 *                        active (a deferred constraint trigger in the migration checks that at commit).
 *   vehicle_owners       the holders of a period: a person or an organisation, one or more.
 *   plate_assignments    the plates the vehicle carried, the current one has no `until`; old ones stay searchable.
 *   libres               the title booklets issued for an ownership period.
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
    PLATE_ENDED_REASONS,
    PLATE_FORMATS,
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
                firstRegisteredOn: date('first_registered_on').notNull(),
                status: text('status', { enum: VEHICLE_STATUSES }).notNull().default('active')
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
                endedReason: text('ended_reason', { enum: PLATE_ENDED_REASONS })
            },
            (t) => [
                index('plate_assignments_vehicle_idx').on(t.vehicleId),
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
                /** null until the number is entered (a booklet printed elsewhere) */
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
