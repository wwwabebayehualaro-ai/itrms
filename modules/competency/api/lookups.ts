/**
 * The form lookups of this slice (task 0.24a): a licence, picked by its number or its holder; a training school and a garage (task
 * 1.3b), organisations of that kind. Facts under a pick are what a counter clerk needs and no more.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { LookupItem, RegistryLookupProvider } from '@itrms/forms/api';
import { contextOfTx, type Tx } from '@itrms/kernel/db';
import { organisations, OrganisationsService } from '@itrms/parties/api';
import { plateAssignments, vehicleHandovers, vehicles, VehiclesService } from '@itrms/vehicles/api';
import { foldPlate, parsePlate, searchKeys } from '@itrms/vehicles/contracts';

import { GARAGE_KIND, TRANSFER_IN_SERVICE, type Licence } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { LicencesService } from './licences.service';

type Key = keyof typeof am;
const text = (key: Key, language: string): string => (language === 'en' ? en : am)[key];

const holderText = (licence: Licence, language: string): string => {
    const name = (language === 'en' ? licence.holder.en : licence.holder.am) ?? licence.holder.am ?? licence.holder.en;
    return name ? [name.given, name.father, name.grandfather].filter(Boolean).join(' ') : '';
};

@Injectable()
export class LicenceLookup implements RegistryLookupProvider {
    readonly key = 'driver-licence';
    // whoever may read people: a records officer files a renewal, an examiner reads its case, and neither has licence:read. It shows
    // a holder's name, grades and expiry, which is what a form needs and nothing sensitive
    readonly permission = 'person:read';

    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    title(language: string): string {
        return text('competency.lookup.licence.title', language);
    }

    facts(language: string): { key: string; label: string }[] {
        return [
            { key: 'holder', label: text('competency.lookup.fact.holder', language) },
            { key: 'grades', label: text('competency.lookup.fact.grades', language) },
            { key: 'validUntil', label: text('competency.lookup.fact.validUntil', language) }
        ];
    }

    async search(tx: Tx, q: string, limit: number, language: string): Promise<LookupItem[]> {
        return (await this.licences.searchForLookup(tx, q, limit)).map((l) => this.item(l, language));
    }

    async resolve(tx: Tx, ids: readonly string[], language: string): Promise<LookupItem[]> {
        return (await this.licences.byIds(tx, ids)).map((l) => this.item(l, language));
    }

    private item(licence: Licence, language: string): LookupItem {
        return {
            id: licence.id,
            active: licence.status === 'active',
            label: licence.number ?? holderText(licence, language),
            facts: [
                {
                    key: 'holder',
                    label: text('competency.lookup.fact.holder', language),
                    value: holderText(licence, language)
                },
                {
                    key: 'grades',
                    label: text('competency.lookup.fact.grades', language),
                    value: licence.grades.map((g) => this.licences.gradeText(g.name, language)).join(', ')
                },
                {
                    key: 'validUntil',
                    label: text('competency.lookup.fact.validUntil', language),
                    value: licence.validUntil
                }
            ]
        };
    }
}

/**
 * The office a vehicle is released to (task 1.4c): an active office of the region, not the caller's, that takes vehicles in
 * (DVC-15). A person reads only their own branch of the tree, so the offices are listed by the register's reviewed lookup.
 */
@Injectable()
export class OfficeLookup implements RegistryLookupProvider {
    readonly key = 'office';
    readonly permission = 'vehicle:read';

    title(language: string): string {
        return text('competency.lookup.office.title', language);
    }

    facts(language: string): { key: string; label: string }[] {
        return [{ key: 'code', label: text('competency.lookup.fact.code', language) }];
    }

    async search(tx: Tx, q: string, limit: number, language: string): Promise<LookupItem[]> {
        const { rows } = await tx.execute<{ id: string; code: string; name: Record<string, string> }>(
            sql`select id, code, name from vehicles.handover_destinations(${q.trim()}, ${TRANSFER_IN_SERVICE}, ${limit})`
        );
        return rows.map((r) => this.item(r, language));
    }

    async resolve(tx: Tx, ids: readonly string[], language: string): Promise<LookupItem[]> {
        if (ids.length === 0) return [];
        const { rows } = await tx.execute<{ id: string; code: string; name: Record<string, string> }>(
            sql`select id, code, name from kernel.region_units(${`{${ids.join(',')}}`}::uuid[])`
        );
        return rows.map((r) => this.item(r, language));
    }

    private item(unit: { id: string; code: string; name: Record<string, string> }, language: string): LookupItem {
        return {
            id: unit.id,
            active: true,
            label: unit.name[language] || unit.name.am || unit.code,
            facts: [{ key: 'code', label: text('competency.lookup.fact.code', language), value: unit.code }]
        };
    }
}

/**
 * A vehicle with a release standing from the caller's office (task 1.4c2b, ADR-0059), for the cancellation's request: the
 * register's vehicle lookup lists only active vehicles, and one released outside the region is not. A vehicle is offered
 * whatever the day of its release (the document check is the cancellation's).
 */
@Injectable()
export class ReleasedVehicleLookup implements RegistryLookupProvider {
    readonly key = 'released-vehicle';
    readonly permission = 'vehicle:read';
    /** the most releases of an office read in one search: an office has few standing at a time */
    private static readonly SCAN = 200;

    constructor(@Inject(VehiclesService) private readonly vehicles: VehiclesService) {}

    title(language: string): string {
        return text('competency.lookup.releasedVehicle.title', language);
    }

    facts(language: string): { key: string; label: string }[] {
        return [
            { key: 'plate', label: text('competency.lookup.fact.plate', language) },
            { key: 'vehicle', label: text('competency.lookup.fact.vehicle', language) },
            { key: 'owner', label: text('competency.lookup.fact.owner', language) },
            { key: 'releasedTo', label: text('competency.lookup.fact.releasedTo', language) },
            { key: 'validUntil', label: text('competency.lookup.fact.validUntil', language) }
        ];
    }

    async search(tx: Tx, q: string, limit: number, language: string): Promise<LookupItem[]> {
        // the text is applied before the limit, so an old release is found among many: the chassis key, the federal id, or a plate
        // the vehicle carried, normalised as the register's own search does
        const { key } = searchKeys(q);
        // a plate is read as the register reads it: an old regional plate (AA 2-12345) has a key of its own, not its bare characters
        const parsed = parsePlate(q, await this.vehicles.legacyRegions(tx));
        const plateKey = parsed?.key ?? foldPlate(q).replace(/[^A-Z0-9]/g, '');
        const vin = key.replace(/-/g, '');
        // the keys hold only letters, digits and hyphens: nothing in them is a pattern character
        const like = (part: string) => `%${part}%`;
        const matches =
            vin.length === 0
                ? undefined
                : or(
                      sql`${vehicles.vinKey} like ${like(vin)}`,
                      eq(vehicles.federalVehicleId, key),
                      sql`exists (select 1 from ${plateAssignments} a
                                   where a.vehicle_id = ${vehicles.id} and a.plate_key like ${like(plateKey)})`
                  );
        const rows = await tx
            .select({ release: vehicleHandovers })
            .from(vehicleHandovers)
            .innerJoin(vehicles, eq(vehicles.id, vehicleHandovers.vehicleId))
            .where(
                and(
                    eq(vehicleHandovers.status, 'released'),
                    eq(vehicleHandovers.fromUnitId, contextOfTx(tx).unitId ?? ''),
                    matches
                )
            )
            .orderBy(desc(vehicleHandovers.releasedOn), desc(vehicleHandovers.createdAt))
            .limit(ReleasedVehicleLookup.SCAN);
        const items = await this.items(
            tx,
            rows.map((r) => r.release),
            language
        );
        return items.slice(0, limit).map((i) => i.item);
    }

    async resolve(tx: Tx, ids: readonly string[], language: string): Promise<LookupItem[]> {
        if (ids.length === 0) return [];
        const releases = await tx
            .select()
            .from(vehicleHandovers)
            .where(
                and(
                    eq(vehicleHandovers.status, 'released'),
                    eq(vehicleHandovers.fromUnitId, contextOfTx(tx).unitId ?? ''),
                    inArray(vehicleHandovers.vehicleId, [...ids])
                )
            );
        const standing = new Set(releases.map((r) => r.vehicleId));
        const known = await this.items(tx, releases, language);
        const rest = ids.filter((id) => !standing.has(id));
        // a vehicle the caller's office does not hold a release of is no pick: it is returned inactive, so the form says so
        const others = (await this.vehicles.summaries(tx, rest)).map<LookupItem>((v) => ({
            id: v.id,
            active: false,
            label: v.currentPlate?.text ?? v.federalVehicleId ?? v.chassisNumber,
            facts: []
        }));
        return [...known.map((i) => i.item), ...others];
    }

    private async items(
        tx: Tx,
        releases: readonly (typeof vehicleHandovers.$inferSelect)[],
        language: string
    ): Promise<{ item: LookupItem }[]> {
        if (releases.length === 0) return [];
        const byVehicle = new Map(
            (
                await this.vehicles.summaries(
                    tx,
                    releases.map((r) => r.vehicleId)
                )
            ).map((v) => [v.id, v])
        );
        const unitIds = releases.flatMap((r) => (r.toUnitId ? [r.toUnitId] : []));
        const units = new Map<string, string>();
        if (unitIds.length > 0) {
            const { rows } = await tx.execute<{ id: string; code: string; name: Record<string, string> }>(
                sql`select id, code, name from kernel.region_units(${`{${unitIds.join(',')}}`}::uuid[])`
            );
            for (const u of rows) units.set(u.id, u.name[language] || u.name.am || u.code);
        }
        return releases.flatMap((r) => {
            const v = byVehicle.get(r.vehicleId);
            if (!v) return [];
            const owners = v.owners.map((o) => (language === 'en' ? o.name.en : o.name.am)).join(', ');
            const to = r.toUnitId
                ? (units.get(r.toUnitId) ?? '')
                : [r.destinationName, r.destinationRegion].filter(Boolean).join(', ');
            const plate = v.currentPlate?.text ?? null;
            return [
                {
                    item: {
                        id: v.id,
                        active: true,
                        label: plate ?? v.federalVehicleId ?? v.chassisNumber,
                        facts: [
                            { key: 'plate', label: text('competency.lookup.fact.plate', language), value: plate },
                            {
                                key: 'vehicle',
                                label: text('competency.lookup.fact.vehicle', language),
                                value: `${v.make} ${v.model}`
                            },
                            {
                                key: 'owner',
                                label: text('competency.lookup.fact.owner', language),
                                value: owners || null
                            },
                            {
                                key: 'releasedTo',
                                label: text('competency.lookup.fact.releasedTo', language),
                                value: to || null
                            },
                            {
                                key: 'validUntil',
                                label: text('competency.lookup.fact.validUntil', language),
                                value: r.validUntil
                            }
                        ]
                    }
                }
            ];
        });
    }
}

/** An organisation of one kind in the register, picked by name: a training school, a garage. */
abstract class OrganisationOfKindLookup implements RegistryLookupProvider {
    abstract readonly key: string;
    readonly permission = 'organisation:read';
    protected abstract readonly kind: string;
    protected abstract readonly titleKey: Key;

    constructor(private readonly organisations: OrganisationsService) {}

    title(language: string): string {
        return text(this.titleKey, language);
    }

    facts(): { key: string; label: string }[] {
        return [];
    }

    private item(found: { id: string; name: Record<string, string> }, language: string): LookupItem {
        return { id: found.id, active: true, label: found.name[language] ?? found.name.am ?? '', facts: [] };
    }

    async search(tx: Tx, q: string, limit: number, language: string): Promise<LookupItem[]> {
        // the register's own folded name search; ask for more, keep the kind
        const found = await this.organisations.search(tx, q, Math.min(limit * 4, 50));
        return found
            .filter((o) => o.kind === this.kind)
            .slice(0, limit)
            .map((o) => this.item(o, language));
    }

    async resolve(tx: Tx, ids: readonly string[], language: string): Promise<LookupItem[]> {
        if (ids.length === 0) return [];
        const rows = await tx
            .select({ id: organisations.id, name: organisations.name })
            .from(organisations)
            .where(and(eq(organisations.kind, this.kind), inArray(organisations.id, [...ids])));
        return rows.map((o) => this.item(o, language));
    }
}

@Injectable()
export class TrainingSchoolLookup extends OrganisationOfKindLookup {
    readonly key = 'training-school';
    protected readonly kind = 'training_school';
    protected readonly titleKey = 'competency.lookup.school.title';

    constructor(@Inject(OrganisationsService) organisations: OrganisationsService) {
        super(organisations);
    }
}

/** The garage a failed vehicle was repaired at (task 1.3b). */
@Injectable()
export class GarageLookup extends OrganisationOfKindLookup {
    readonly key = 'garage';
    protected readonly kind = GARAGE_KIND;
    protected readonly titleKey = 'competency.lookup.garage.title';

    constructor(@Inject(OrganisationsService) organisations: OrganisationsService) {
        super(organisations);
    }
}
