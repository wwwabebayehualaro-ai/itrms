/**
 * Reading the vehicle register (task 1.1a): the search by plate (current or old), chassis number, engine number or federal
 * vehicle id from any office of the region, a vehicle's record with its ownership history, plates and libres, and the
 * summaries other slices show under a pick. Every read runs under RLS (class R: the region reads); the ranked search itself
 * is `vehicles.search_vehicles`, a reviewed SECURITY DEFINER function limited to the caller's region.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { contextOfTx, type Tx } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';
import { OrganisationsService, PersonsService } from '@itrms/parties/api';
import { SettingsService } from '@itrms/kernel/settings';
import { users } from '@itrms/kernel/tables';
import type { z } from 'zod';

import {
    DEFAULT_LEGACY_PLATE_REGIONS,
    foldPlate,
    LEGACY_PLATE_REGIONS_SETTING,
    parsePlate,
    searchKeys,
    type Holder,
    type LegacyPlateRegion,
    type VehicleMatch,
    type VehicleSearchQuery,
    type vehicleListSchema,
    type vehicleSchema,
    type vehicleSummarySchema
} from '../contracts';
import { joinName, unitRefs, type UnitRef } from './support';
import {
    libres,
    plateAssignments,
    vehicleCategories,
    vehicleOwners,
    vehicleOwnerships,
    vehicles
} from './vehicles.table';

type Vehicle = z.infer<typeof vehicleSchema>;
type VehicleSummary = z.infer<typeof vehicleSummarySchema>;
type VehicleList = z.infer<typeof vehicleListSchema>;
type Row = typeof vehicles.$inferSelect;
type OwnerRow = typeof vehicleOwners.$inferSelect;

/** What the search function ranks a way of matching by; the order of the ranks is the function's. */
const MATCHES: readonly VehicleMatch[] = [
    'federal_id',
    'vin',
    'plate',
    'old_plate',
    'engine',
    'vin_part',
    'plate_part'
];
const isMatch = (value: string): value is VehicleMatch => (MATCHES as readonly string[]).includes(value);

@Injectable()
export class VehiclesService {
    constructor(
        @Inject(PersonsService) private readonly persons: PersonsService,
        @Inject(OrganisationsService) private readonly organisations: OrganisationsService,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    /** The region's old plate codes as the caller's office has them (the setting, else the shipped list). */
    async legacyRegions(tx: Tx): Promise<LegacyPlateRegion[]> {
        const unitId = contextOfTx(tx).unitId;
        const value = unitId
            ? await this.settings.value<LegacyPlateRegion[]>(tx, unitId, LEGACY_PLATE_REGIONS_SETTING)
            : undefined;
        return value ?? DEFAULT_LEGACY_PLATE_REGIONS.map((r) => ({ code: r.code, aliases: [...r.aliases] }));
    }

    async categories(tx: Tx) {
        const rows = await tx.select().from(vehicleCategories).orderBy(asc(vehicleCategories.key));
        return rows.map((r) => ({
            id: r.id,
            key: r.key,
            name: r.name,
            family: r.family,
            needsSeats: r.needsSeats,
            needsLoad: r.needsLoad,
            active: r.active
        }));
    }

    /**
     * A search by text (ranked: exact federal id, exact chassis number, current plate, old plate, engine number, then a part
     * of a chassis number or plate), or a list by owner and status, newest first, in pages. The owner is the holder of the
     * vehicle's last ownership period: its owners now, or those it left the register with. Both filters are applied before the
     * ranked limit (task 1.2e).
     */
    async search(tx: Tx, query: VehicleSearchQuery): Promise<VehicleList> {
        if (query.q) {
            const keys = searchKeys(query.q);
            const parsed = parsePlate(query.q, await this.legacyRegions(tx));
            const plateKey = parsed?.key ?? foldPlate(query.q).replace(/[^A-Z0-9]/g, '');
            const found = await tx.execute<{ vehicle_id: string; matched: string }>(
                sql`select vehicle_id, matched from vehicles.search_vehicles(${keys.key}, ${plateKey}, ${Math.min(query.limit, 50)},
                                                                   ${query.status ?? null}, ${query.ownerId ?? null}::uuid)`
            );
            const how = new Map(found.rows.map((r) => [r.vehicle_id, r.matched]));
            const items = (await this.summaries(tx, [...how.keys()])).slice(0, query.limit).map((v) => {
                const matched = how.get(v.id) ?? '';
                return { ...v, matched: isMatch(matched) ? matched : null };
            });
            return { items, nextCursor: null };
        }
        const conditions: (SQL | undefined)[] = [
            query.status ? eq(vehicles.status, query.status) : undefined,
            query.after ? lt(vehicles.id, query.after) : undefined,
            query.ownerId
                ? sql`exists (select 1 from vehicles.vehicle_owners w
                       where w.ownership_id = (select o.id from vehicles.vehicle_ownerships o where o.vehicle_id = ${vehicles.id}
                                                order by o.since desc limit 1)
                         and (w.person_id = ${query.ownerId} or w.organisation_id = ${query.ownerId}))`
                : undefined
        ];
        const rows = await tx
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(and(...conditions))
            .orderBy(desc(vehicles.id))
            .limit(query.limit + 1);
        const ids = rows.map((r) => r.id);
        const more = ids.length > query.limit;
        const page = ids.slice(0, query.limit);
        return { items: await this.summaries(tx, page), nextCursor: more ? (page[page.length - 1] ?? null) : null };
    }

    /** The vehicles among `ids` the caller's scope shows, in the order asked, with no `matched`. */
    async summaries(tx: Tx, ids: readonly string[]): Promise<VehicleSummary[]> {
        const wanted = [...new Set(ids)];
        if (wanted.length === 0) return [];
        const rows = await tx.select().from(vehicles).where(inArray(vehicles.id, wanted));
        const categories = new Map(
            (
                await tx
                    .select()
                    .from(vehicleCategories)
                    .where(
                        inArray(
                            vehicleCategories.id,
                            rows.map((r) => r.categoryId)
                        )
                    )
            ).map((c) => [c.id, c])
        );
        const plates = new Map(
            (
                await tx
                    .select()
                    .from(plateAssignments)
                    .where(and(inArray(plateAssignments.vehicleId, wanted), isNull(plateAssignments.until)))
            ).map((p) => [p.vehicleId, p])
        );
        const open = await tx
            .select()
            .from(vehicleOwnerships)
            .where(and(inArray(vehicleOwnerships.vehicleId, wanted), isNull(vehicleOwnerships.until)));
        const holders = await this.holdersOf(
            tx,
            open.map((o) => o.id)
        );
        const units = await unitRefs(
            tx,
            rows.map((r) => r.handlingUnitId)
        );
        const ownersOf = new Map(open.map((o) => [o.vehicleId, holders.get(o.id) ?? []]));
        // the second person who verified a back-capture, by the name staff know them by (users are a regional record)
        const verifierIds = [...new Set(rows.flatMap((r) => (r.migrationVerifiedBy ? [r.migrationVerifiedBy] : [])))];
        const verifiers = new Map(
            verifierIds.length === 0
                ? []
                : (
                      await tx
                          .select({ id: users.id, name: users.displayName })
                          .from(users)
                          .where(inArray(users.id, verifierIds))
                  ).map((u) => [u.id, u.name])
        );
        const byId = new Map(
            rows.map((r) => {
                const category = categories.get(r.categoryId);
                const plate = plates.get(r.id);
                return [
                    r.id,
                    {
                        ...summaryOf(r, units),
                        category: { key: category?.key ?? '', name: category?.name ?? {} },
                        currentPlate: plate ? { text: plate.plateText, format: plate.format } : null,
                        owners: ownersOf.get(r.id) ?? [],
                        migration: migrationOf(r, verifiers)
                    }
                ];
            })
        );
        return ids.flatMap((id) => byId.get(id) ?? []);
    }

    async get(tx: Tx, id: string): Promise<Vehicle> {
        const [summary] = await this.summaries(tx, [id]);
        const [row] = await tx.select().from(vehicles).where(eq(vehicles.id, id));
        if (!summary || !row) throw new NotFoundError();
        // a record read by its id was not found by a search
        const { matched, ...base } = summary;
        void matched;
        const plates = await tx
            .select()
            .from(plateAssignments)
            .where(eq(plateAssignments.vehicleId, id))
            .orderBy(desc(plateAssignments.since), desc(plateAssignments.id));
        const ownerships = await tx
            .select()
            .from(vehicleOwnerships)
            .where(eq(vehicleOwnerships.vehicleId, id))
            .orderBy(desc(vehicleOwnerships.since));
        const holders = await this.holdersOf(
            tx,
            ownerships.map((o) => o.id)
        );
        const libreRows = await tx
            .select()
            .from(libres)
            .where(eq(libres.vehicleId, id))
            .orderBy(desc(libres.issuedOn), desc(libres.id));
        const units = await unitRefs(
            tx,
            libreRows.map((l) => l.issuingUnitId)
        );
        return {
            ...base,
            federalIdSource: row.federalIdSource,
            chassisKind: row.chassisKind,
            vinCheck: row.vinCheck,
            engineNumber: row.engineNumber,
            seats: row.seats,
            loadCapacityKg: row.loadCapacityKg,
            grossWeightKg: row.grossWeightKg,
            engineCc: row.engineCc,
            axles: row.axles,
            madeIn: row.madeIn,
            engineHp: row.engineHp,
            cylinders: row.cylinders,
            lengthMm: row.lengthMm,
            widthMm: row.widthMm,
            heightMm: row.heightMm,
            tyreSize: row.tyreSize,
            tyres: row.tyres,
            netWeightKg: row.netWeightKg,
            colour: row.colour,
            fuel: row.fuel,
            firstRegisteredOn: row.firstRegisteredOn,
            plates: plates.map((p) => ({
                id: p.id,
                text: p.plateText,
                key: p.plateKey,
                format: p.format,
                legacyUseCode: p.legacyUseCode,
                legacyRegionCode: p.legacyRegionCode,
                source: p.source,
                since: p.since,
                until: p.until,
                endedReason: p.endedReason,
                replacedById: p.replacedById
            })),
            ownerships: ownerships.map((o) => ({
                id: o.id,
                since: o.since,
                until: o.until,
                acquiredBy: o.acquiredBy,
                caseId: o.caseId,
                note: o.note,
                holders: holders.get(o.id) ?? []
            })),
            libres: libreRows.map((l) => ({
                id: l.id,
                ownershipId: l.ownershipId,
                number: l.number,
                issuedOn: l.issuedOn,
                issuingUnit: units.get(l.issuingUnitId) ?? { id: l.issuingUnitId, code: '', name: {} },
                status: l.status,
                replacesId: l.replacesId,
                nationalReference: l.nationalReference,
                caseId: l.caseId
            })),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString()
        };
    }

    /** The holders of each ownership period, in their order. */
    private async holdersOf(tx: Tx, ownershipIds: readonly string[]): Promise<Map<string, Holder[]>> {
        const out = new Map<string, Holder[]>();
        if (ownershipIds.length === 0) return out;
        const owners: OwnerRow[] = await tx
            .select()
            .from(vehicleOwners)
            .where(inArray(vehicleOwners.ownershipId, [...ownershipIds]))
            .orderBy(asc(vehicleOwners.ordinal));
        const people = new Map(
            (
                await this.persons.summaries(
                    tx,
                    owners.flatMap((o) => (o.personId ? [o.personId] : []))
                )
            ).map((p) => [p.id, p])
        );
        const organisations = new Map(
            (
                await this.organisations.summaries(
                    tx,
                    owners.flatMap((o) => (o.organisationId ? [o.organisationId] : []))
                )
            ).map((o) => [o.id, o])
        );
        for (const owner of owners) {
            let holder: Holder | undefined;
            const person = owner.personId ? people.get(owner.personId) : undefined;
            const organisation = owner.organisationId ? organisations.get(owner.organisationId) : undefined;
            if (person) {
                const am = joinName(person.nameAm);
                holder = { kind: 'person', id: person.id, name: { am, en: joinName(person.nameEn) || am } };
            } else if (organisation) {
                holder = { kind: 'organisation', id: organisation.id, name: organisation.name };
            }
            if (holder) out.set(owner.ownershipId, [...(out.get(owner.ownershipId) ?? []), holder]);
        }
        return out;
    }
}

function summaryOf(row: Row, units: ReadonlyMap<string, UnitRef>): VehicleSummary {
    return {
        id: row.id,
        version: row.rowVersion,
        federalVehicleId: row.federalVehicleId,
        chassisNumber: row.chassisNumber,
        make: row.make,
        model: row.model,
        modelYear: row.modelYear,
        category: { key: '', name: {} },
        use: row.use,
        status: row.status,
        currentPlate: null,
        owners: [],
        handlingUnit: units.get(row.handlingUnitId) ?? { id: row.handlingUnitId, code: '', name: {} },
        migration: null,
        matched: null
    };
}

/** Where a vehicle migrated from paper came from and who verified it (ADR-0054); null for one registered in ITRMS. */
function migrationOf(row: Row, verifiers: ReadonlyMap<string, string>): VehicleSummary['migration'] {
    if (!row.migrationSource || !row.paperReference) return null;
    const verifier = row.migrationVerifiedBy;
    return {
        source: row.migrationSource,
        paperReference: row.paperReference,
        caseId: row.migrationCaseId,
        verifiedBy: verifier ? { id: verifier, name: verifiers.get(verifier) ?? '' } : null,
        verifiedAt: row.migrationVerifiedAt?.toISOString() ?? null
    };
}
