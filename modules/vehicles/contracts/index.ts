/**
 * Public entry of @itrms/vehicles (code-structure.md §4): the vehicle register's DTOs and settings. One source per fact: these
 * schemas validate the API's reads and the register commands (the case effects of task 1.2, the seeds, the tests), and write
 * the OpenAPI document.
 *
 * A vehicle is a regional record: any office of the region finds it by plate (current or old), chassis number (VIN) or
 * federal vehicle id; the office that handles it changes it, and only through a case. Its owners are a history of periods
 * with no gap and no overlap, one open while the vehicle is active.
 */
import { z } from 'zod';

import { CHASSIS_KINDS, VIN_CHECKS } from './vin';
import { DEFAULT_LEGACY_PLATE_REGIONS, foldPlate, PLATE_FORMATS } from './plate';

export * from './plate';
export * from './plate-stock';
export * from './vin';

export const VEHICLE_USES = [
    'private',
    'public_transport',
    'commercial',
    'government',
    'ngo',
    'diplomatic',
    'international_org',
    'police',
    'defence'
] as const;
export const VEHICLE_STATUSES = ['active', 'transferred_out', 'deregistered', 'stolen'] as const;
export const FEDERAL_ID_SOURCES = ['national', 'manual'] as const;
export const FUELS = ['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'biofuel', 'other'] as const;
export const CATEGORY_FAMILIES = ['passenger', 'freight', 'special'] as const;
export const ACQUIRED_BY = [
    'first_registration',
    'sale',
    'inheritance',
    'gift',
    'court_order',
    'auction',
    'back_capture'
] as const;
export const PLATE_SOURCES = ['federal', 'legacy', 'manual'] as const;
export const PLATE_ENDED_REASONS = ['exchanged', 'lost', 'retired', 'transferred'] as const;
export const LIBRE_STATUSES = ['issued', 'replaced', 'lost', 'cancelled'] as const;
/** What a search matched: the best of the ways a vehicle was found. */
export const VEHICLE_MATCHES = ['federal_id', 'vin', 'plate', 'old_plate', 'engine', 'vin_part', 'plate_part'] as const;
export const OWNER_KINDS = ['person', 'organisation'] as const;

export type VehicleUse = (typeof VEHICLE_USES)[number];
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export type VehicleMatch = (typeof VEHICLE_MATCHES)[number];

/** The codes of the old regional plates (a list of region codes with their Ethiopic writings), per installation or region. */
export const LEGACY_PLATE_REGIONS_SETTING = 'vehicles.legacy_plate_regions';
export const VEHICLES_SETTINGS = {
    [LEGACY_PLATE_REGIONS_SETTING]: z
        .array(
            z.strictObject({
                // two letters, as every old regional code is: a key `L` + use + code + series + digits then reads one way only
                code: z.string().regex(/^[A-Z]{2}$/, 'two upper-case Latin letters'),
                aliases: z
                    .array(
                        z
                            .string()
                            .trim()
                            .min(1)
                            .max(20)
                            .refine((a) => foldPlate(a) !== '', 'letters, not only separators')
                    )
                    .max(10)
            })
        )
        .max(60)
} as const;
export { DEFAULT_LEGACY_PLATE_REGIONS };

const isoDate = z.iso.date();
const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });
const nameSchema = z.object({ am: z.string(), en: z.string() });

export const holderSchema = z.object({ kind: z.enum(OWNER_KINDS), id: z.uuid(), name: nameSchema });
export type Holder = z.infer<typeof holderSchema>;

export const categorySchema = z.object({
    id: z.uuid(),
    key: z.string(),
    name: z.record(z.string(), z.string()),
    family: z.enum(CATEGORY_FAMILIES),
    needsSeats: z.boolean(),
    needsLoad: z.boolean(),
    active: z.boolean()
});
export type VehicleCategory = z.infer<typeof categorySchema>;
export const categoryListSchema = z.object({ items: z.array(categorySchema) });

export const platePeriodSchema = z.object({
    id: z.uuid(),
    text: z.string(),
    key: z.string(),
    format: z.enum(PLATE_FORMATS),
    legacyUseCode: z.number().int().nullable(),
    legacyRegionCode: z.string().nullable(),
    source: z.enum(PLATE_SOURCES),
    since: isoDate,
    until: isoDate.nullable(),
    endedReason: z.enum(PLATE_ENDED_REASONS).nullable()
});

export const ownershipSchema = z.object({
    id: z.uuid(),
    since: isoDate,
    /** null while the period is open */
    until: isoDate.nullable(),
    acquiredBy: z.enum(ACQUIRED_BY),
    caseId: z.uuid().nullable(),
    note: z.string().nullable(),
    holders: z.array(holderSchema)
});

export const libreSchema = z.object({
    id: z.uuid(),
    ownershipId: z.uuid(),
    number: z.string().nullable(),
    issuedOn: isoDate,
    issuingUnit: unitRefSchema,
    status: z.enum(LIBRE_STATUSES),
    replacesId: z.uuid().nullable(),
    nationalReference: z.string().nullable(),
    caseId: z.uuid().nullable()
});

export const vehicleSummarySchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    federalVehicleId: z.string().nullable(),
    chassisNumber: z.string(),
    make: z.string(),
    model: z.string(),
    modelYear: z.number().int(),
    category: z.object({ key: z.string(), name: z.record(z.string(), z.string()) }),
    use: z.enum(VEHICLE_USES),
    status: z.enum(VEHICLE_STATUSES),
    currentPlate: z.object({ text: z.string(), format: z.enum(PLATE_FORMATS) }).nullable(),
    owners: z.array(holderSchema),
    handlingUnit: unitRefSchema,
    /** how the search found it (a search only) */
    matched: z.enum(VEHICLE_MATCHES).nullable()
});
export type VehicleSummary = z.infer<typeof vehicleSummarySchema>;

/**
 * The facts the temporary libre and the booklet's data page carry besides the register's first ones (task 1.2d): where the
 * vehicle was made, its engine's power and cylinders, its size, its tyres and its weight empty. All optional.
 */
export const vehicleDetailsSchema = z.object({
    madeIn: z.string().trim().min(1).max(60).optional(),
    engineHp: z.number().int().min(1).max(5000).optional(),
    cylinders: z.number().int().min(1).max(24).optional(),
    lengthMm: z.number().int().min(500).max(30_000).optional(),
    widthMm: z.number().int().min(500).max(5000).optional(),
    heightMm: z.number().int().min(500).max(6000).optional(),
    tyreSize: z.string().trim().min(1).max(20).optional(),
    tyres: z.number().int().min(2).max(40).optional(),
    netWeightKg: z.number().int().min(1).max(200_000).optional()
});
export type VehicleDetails = z.infer<typeof vehicleDetailsSchema>;
const VEHICLE_DETAILS_OUT = {
    madeIn: z.string().nullable(),
    engineHp: z.number().int().nullable(),
    cylinders: z.number().int().nullable(),
    lengthMm: z.number().int().nullable(),
    widthMm: z.number().int().nullable(),
    heightMm: z.number().int().nullable(),
    tyreSize: z.string().nullable(),
    tyres: z.number().int().nullable(),
    netWeightKg: z.number().int().nullable()
};

export const vehicleSchema = vehicleSummarySchema.omit({ matched: true }).extend({
    federalIdSource: z.enum(FEDERAL_ID_SOURCES).nullable(),
    chassisKind: z.enum(CHASSIS_KINDS),
    vinCheck: z.enum(VIN_CHECKS),
    engineNumber: z.string().nullable(),
    seats: z.number().int().nullable(),
    loadCapacityKg: z.number().int().nullable(),
    grossWeightKg: z.number().int().nullable(),
    engineCc: z.number().int().nullable(),
    axles: z.number().int().nullable(),
    colour: z.string().nullable(),
    fuel: z.enum(FUELS).nullable(),
    ...VEHICLE_DETAILS_OUT,
    firstRegisteredOn: isoDate,
    plates: z.array(platePeriodSchema),
    ownerships: z.array(ownershipSchema),
    libres: z.array(libreSchema),
    createdAt: z.string(),
    updatedAt: z.string()
});
export type Vehicle = z.infer<typeof vehicleSchema>;

/** `GET /vehicles?q=&ownerId=&status=&after=&limit=` */
export const vehicleSearchQuerySchema = z.strictObject({
    /** a plate (current or old), a chassis number (all of it or its last characters), an engine number or a federal id */
    q: z.string().trim().min(1).max(40).optional(),
    /** a person or an organisation: the vehicles it holds now */
    ownerId: z.uuid().optional(),
    status: z.enum(VEHICLE_STATUSES).optional(),
    /** the previous page's `nextCursor` (opaque); a search with `q` is ranked and has one page */
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20)
});
export type VehicleSearchQuery = z.infer<typeof vehicleSearchQuerySchema>;

export const vehicleListSchema = z.object({
    items: z.array(vehicleSummarySchema),
    nextCursor: z.string().nullable()
});

const ownerRefSchema = z.strictObject({ kind: z.enum(OWNER_KINDS), id: z.uuid() });
const ownersSchema = z
    .array(ownerRefSchema)
    .min(1)
    .max(5)
    .refine((owners) => new Set(owners.map((o) => o.id)).size === owners.length, 'an owner is listed twice');

/** The federal vehicle id: letters, digits and hyphens, upper-cased. */
export const federalVehicleIdSchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{4,40}$/, 'letters, digits and hyphens');

/**
 * The office counter the registration certificate (the temporary libre, ADR-0050) is numbered from, and its pattern:
 * `{unit code}/RC/000123`. The libre itself carries the federal booklet's serial, never a number of ours.
 */
export const REGISTRATION_CERTIFICATE_COUNTER = 'vehicles.registration-certificate';
export const REGISTRATION_CERTIFICATE_PATTERN = '{unit}/RC/{seq:06}';

/** The command that registers a vehicle with its first owners (the register's own service, not an HTTP endpoint). */
export const vehicleRegisterSchema = z
    .strictObject({
        federalVehicleId: federalVehicleIdSchema.optional(),
        federalIdSource: z.enum(FEDERAL_ID_SOURCES).optional(),
        chassisNumber: z.string().trim().min(4).max(40),
        chassisKind: z.enum(CHASSIS_KINDS).optional(),
        /** the officer checked the chassis plate: a binding check digit that does not match is recorded as a mismatch */
        acceptVinMismatch: z.boolean().optional(),
        engineNumber: z.string().trim().min(1).max(30).optional(),
        make: z.string().trim().min(1).max(60),
        model: z.string().trim().min(1).max(60),
        modelYear: z.number().int().min(1900).max(2100),
        categoryKey: z.string().min(1).max(40),
        use: z.enum(VEHICLE_USES),
        seats: z.number().int().min(1).max(200).optional(),
        loadCapacityKg: z.number().int().min(1).max(200_000).optional(),
        grossWeightKg: z.number().int().min(1).max(200_000).optional(),
        engineCc: z.number().int().min(1).max(100_000).optional(),
        axles: z.number().int().min(1).max(12).optional(),
        colour: z.string().trim().min(1).max(30).optional(),
        fuel: z.enum(FUELS).optional(),
        ...vehicleDetailsSchema.shape,
        firstRegisteredOn: isoDate,
        owners: ownersSchema,
        /** the first period's start (default: the first registration date) */
        since: isoDate.optional(),
        acquiredBy: z.enum(ACQUIRED_BY).default('first_registration'),
        caseId: z.uuid().optional(),
        note: z.string().trim().min(1).max(500).optional()
    })
    .refine((v) => (v.federalVehicleId === undefined) === (v.federalIdSource === undefined), {
        path: ['federalIdSource'],
        message: 'send the source with the federal vehicle id'
    });
export type VehicleRegister = z.infer<typeof vehicleRegisterSchema>;

export const ownershipTransferSchema = z.strictObject({
    since: isoDate,
    owners: ownersSchema,
    acquiredBy: z.enum(ACQUIRED_BY).exclude(['first_registration']),
    caseId: z.uuid().optional(),
    note: z.string().trim().min(1).max(500).optional()
});
export type OwnershipTransfer = z.infer<typeof ownershipTransferSchema>;

export const plateRecordSchema = z.strictObject({
    text: z.string().trim().min(3).max(40),
    source: z.enum(PLATE_SOURCES),
    since: isoDate,
    /** why the vehicle's current plate ends with this one */
    endedReason: z.enum(PLATE_ENDED_REASONS).default('exchanged')
});
export type PlateRecord = z.infer<typeof plateRecordSchema>;

export const libreRecordSchema = z.strictObject({
    number: z.string().trim().min(1).max(40).optional(),
    issuedOn: isoDate,
    issuingUnitId: z.uuid().optional(),
    nationalReference: z.string().trim().min(1).max(60).optional(),
    caseId: z.uuid().optional()
});
export type LibreRecord = z.infer<typeof libreRecordSchema>;

/** The federal booklet a libre was written in (ADR-0050): its serial as printed, and the national reference when given. */
export const libreBookletSchema = z.strictObject({
    number: z.string().trim().min(1).max(40),
    nationalReference: z.string().trim().min(1).max(60).optional()
});
export type LibreBooklet = z.infer<typeof libreBookletSchema>;

export const statusChangeSchema = z.strictObject({
    status: z.enum(VEHICLE_STATUSES).exclude(['active']),
    /** the day the vehicle left the register (the open ownership period ends then) */
    on: isoDate
});
export type StatusChange = z.infer<typeof statusChangeSchema>;
