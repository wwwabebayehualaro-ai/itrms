/**
 * The register's provider for form fields of type RegistryLookup (task 1.1a): a vehicle is picked by plate, chassis number,
 * engine number or federal id, and the form stores only the id. The facts shown under a pick are the vehicle's, and the
 * owners' names the register itself shows; never a national id or a phone.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { LookupFact, LookupItem, RegistryLookupProvider } from '@itrms/forms/api';
import type { Tx } from '@itrms/kernel/db';

import type { MigrationSource, VehicleSummary } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { VehiclesService } from './vehicles.service';

type Key = keyof typeof am;

const text = (key: Key, language: string, params: Record<string, string> = {}): string =>
    (language === 'en' ? en : am)[key].replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole);

const localized = (name: Record<string, string>, language: string, fallback = ''): string =>
    name[language] ?? name.am ?? name.en ?? fallback;

const fact = (key: string, label: Key, value: string | null, language: string): LookupFact => ({
    key,
    label: text(label, language),
    value
});

const SOURCE: Record<MigrationSource, Key> = {
    back_capture: 'vehicles.migration.source.back_capture',
    import: 'vehicles.migration.source.import'
};

/** "From paper: <reference>, verified by <name>", or null for a vehicle registered in ITRMS. */
function migrated(v: VehicleSummary, language: string): string | null {
    if (!v.migration) return null;
    const params = { source: text(SOURCE[v.migration.source], language), reference: v.migration.paperReference };
    return v.migration.verifiedBy
        ? text('vehicles.migration.summaryVerified', language, { ...params, name: v.migration.verifiedBy.name })
        : text('vehicles.migration.summary', language, params);
}

@Injectable()
export class VehicleLookup implements RegistryLookupProvider {
    readonly key = 'vehicle';
    readonly permission = 'vehicle:read';

    constructor(@Inject(VehiclesService) private readonly vehicles: VehiclesService) {}

    title(language: string): string {
        return text('vehicles.lookup.vehicle.title', language);
    }

    facts(language: string): { key: string; label: string }[] {
        return [
            { key: 'plate', label: text('vehicles.field.plate', language) },
            { key: 'makeModel', label: text('vehicles.field.makeModel', language) },
            { key: 'year', label: text('vehicles.field.year', language) },
            { key: 'category', label: text('vehicles.field.category', language) },
            { key: 'owner', label: text('vehicles.field.owner', language) },
            { key: 'federalId', label: text('vehicles.field.federalId', language) },
            { key: 'handlingUnit', label: text('vehicles.field.handlingUnit', language) },
            { key: 'migrated', label: text('vehicles.field.migrated', language) }
        ];
    }

    async search(tx: Tx, q: string, limit: number, language: string): Promise<LookupItem[]> {
        // the search finds a vehicle in any status: ask for more, keep the ones on the register
        const found = await this.vehicles.search(tx, { q, limit: Math.min(limit * 2, 100) });
        return found.items
            .filter((v) => v.status === 'active')
            .slice(0, limit)
            .map((v) => this.item(v, language));
    }

    async resolve(tx: Tx, ids: readonly string[], language: string): Promise<LookupItem[]> {
        // not in the caller's region (RLS) or unknown: not returned
        return (await this.vehicles.summaries(tx, ids)).map((v) => this.item(v, language));
    }

    private item(v: VehicleSummary, language: string): LookupItem {
        const owners = v.owners.map((o) => (language === 'en' ? o.name.en : o.name.am)).join(', ');
        return {
            id: v.id,
            label: v.currentPlate?.text ?? v.federalVehicleId ?? v.chassisNumber,
            active: v.status === 'active',
            facts: [
                fact('plate', 'vehicles.field.plate', v.currentPlate?.text ?? null, language),
                fact('makeModel', 'vehicles.field.makeModel', `${v.make} ${v.model}`, language),
                fact('year', 'vehicles.field.year', String(v.modelYear), language),
                fact(
                    'category',
                    'vehicles.field.category',
                    localized(v.category.name, language, v.category.key),
                    language
                ),
                fact('owner', 'vehicles.field.owner', owners || null, language),
                fact('federalId', 'vehicles.field.federalId', v.federalVehicleId, language),
                fact(
                    'handlingUnit',
                    'vehicles.field.handlingUnit',
                    localized(v.handlingUnit.name, language, v.handlingUnit.code),
                    language
                ),
                // migrated from its paper file (ADR-0054): the file's reference and who verified the capture
                fact('migrated', 'vehicles.field.migrated', migrated(v, language), language)
            ]
        };
    }
}
