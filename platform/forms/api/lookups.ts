/**
 * Registry lookups (task 0.18): a form field of type RegistryLookup stores the id of a regional record (a person, an
 * organisation). The registries own the records; they register a provider here (in `onModuleInit`) and forms never import
 * them (ADR-0027: platform does not import modules).
 */
import { Injectable } from '@nestjs/common';
import type { Tx } from '@itrms/kernel/db';

/** One non-sensitive fact shown under the picked record (never a national id, phone or birth date). */
export interface LookupFact {
    key: string;
    label: string;
    value: string | null;
}

export interface LookupItem {
    id: string;
    label: string;
    active: boolean;
    facts: LookupFact[];
}

export interface RegistryLookupProvider {
    /** The key a field's `provider` prop names, and the manifest's `lookups` entry: 'person', 'organisation'. */
    key: string;
    /** The permission needed to search the registry and read its items, e.g. 'person:read'. */
    permission: string;
    title(language: string): string;
    facts(language: string): { key: string; label: string }[];
    /** Active records matching the text, in the caller's scope. */
    search(tx: Tx, q: string, limit: number, language: string): Promise<LookupItem[]>;
    /** The records among `ids` that the caller's scope shows, of any status. */
    resolve(tx: Tx, ids: readonly string[], language: string): Promise<LookupItem[]>;
}

@Injectable()
export class RegistryLookups {
    private readonly providers = new Map<string, RegistryLookupProvider>();

    register(provider: RegistryLookupProvider): void {
        if (this.providers.has(provider.key)) throw new Error(`Registry lookup "${provider.key}" is registered twice.`);
        this.providers.set(provider.key, provider);
    }

    get(key: string): RegistryLookupProvider | undefined {
        return this.providers.get(key);
    }

    list(): RegistryLookupProvider[] {
        return [...this.providers.values()];
    }
}
