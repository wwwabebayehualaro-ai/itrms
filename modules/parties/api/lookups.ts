/**
 * The register's providers for form fields of type RegistryLookup (task 0.18): a person and an organisation are picked by
 * name and the form stores only the id. The facts shown under a pick are non-sensitive: never a Fayda number, phone or
 * birth date.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { LookupFact, LookupItem, RegistryLookupProvider } from '@itrms/forms/api';
import type { Tx } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';

import type { PersonName, PersonSummary } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { OrganisationsService } from './organisations.service';
import { PersonsService } from './persons.service';

type OrganisationSummary = Awaited<ReturnType<OrganisationsService['search']>>[number];
type Key = keyof typeof am;

const text = (key: Key, language: string): string => (language === 'en' ? en : am)[key];

const nameText = (name: PersonName | null): string | null =>
    name ? [name.given, name.father, name.grandfather].filter(Boolean).join(' ') : null;

const unitText = (unit: { code: string; name: Record<string, string> }, language: string): string =>
    unit.name[language] ?? unit.name.am ?? unit.name.en ?? unit.code;

const fact = (key: string, label: Key, value: string | null, language: string): LookupFact => ({
    key,
    label: text(label, language),
    value
});

@Injectable()
export class PersonLookup implements RegistryLookupProvider {
    readonly key = 'person';
    readonly permission = 'person:read';

    constructor(@Inject(PersonsService) private readonly persons: PersonsService) {}

    title(language: string): string {
        return text('parties.lookup.person.title', language);
    }

    facts(language: string): { key: string; label: string }[] {
        return [
            { key: 'nameAm', label: text('parties.lookup.fact.nameAm', language) },
            { key: 'nameEn', label: text('parties.lookup.fact.nameEn', language) },
            { key: 'sex', label: text('parties.field.sex', language) },
            { key: 'birthYear', label: text('parties.field.birthYear', language) },
            { key: 'handlingUnit', label: text('parties.field.handlingUnit', language) }
        ];
    }

    async search(tx: Tx, q: string, limit: number, language: string): Promise<LookupItem[]> {
        // the search returns merged records too: ask for more, keep the active ones
        const found = await this.persons.search(tx, q, Math.min(limit * 2, 50));
        return found
            .filter((p) => p.status === 'active')
            .slice(0, limit)
            .map((p) => this.item(p, language));
    }

    async resolve(tx: Tx, ids: readonly string[], language: string): Promise<LookupItem[]> {
        return (await this.persons.summaries(tx, ids)).map((p) => this.item(p, language));
    }

    private item(p: PersonSummary, language: string): LookupItem {
        const am = nameText(p.nameAm);
        const en = nameText(p.nameEn);
        return {
            id: p.id,
            label: (language === 'en' ? en : null) ?? am ?? '',
            active: p.status === 'active',
            facts: [
                fact('nameAm', 'parties.lookup.fact.nameAm', am, language),
                fact('nameEn', 'parties.lookup.fact.nameEn', en, language),
                fact('sex', 'parties.field.sex', text(`parties.sex.${p.sex}`, language), language),
                fact(
                    'birthYear',
                    'parties.field.birthYear',
                    p.birthYear === null ? null : String(p.birthYear),
                    language
                ),
                fact('handlingUnit', 'parties.field.handlingUnit', unitText(p.handlingUnit, language), language)
            ]
        };
    }
}

@Injectable()
export class OrganisationLookup implements RegistryLookupProvider {
    readonly key = 'organisation';
    readonly permission = 'organisation:read';

    constructor(@Inject(OrganisationsService) private readonly organisations: OrganisationsService) {}

    title(language: string): string {
        return text('parties.lookup.organisation.title', language);
    }

    facts(language: string): { key: string; label: string }[] {
        return [
            { key: 'kind', label: text('parties.field.kind', language) },
            { key: 'tin', label: text('parties.field.tin', language) },
            { key: 'licenceNumber', label: text('parties.field.licenceNumber', language) },
            { key: 'handlingUnit', label: text('parties.field.handlingUnit', language) }
        ];
    }

    async search(tx: Tx, q: string, limit: number, language: string): Promise<LookupItem[]> {
        return (await this.organisations.search(tx, q, limit)).map((o) => this.item(o, language));
    }

    async resolve(tx: Tx, ids: readonly string[], language: string): Promise<LookupItem[]> {
        const items: LookupItem[] = [];
        for (const id of new Set(ids)) {
            try {
                items.push(this.item(await this.organisations.get(tx, id), language));
            } catch (error) {
                // not in the caller's region (RLS) or unknown: not returned
                if (!(error instanceof NotFoundError)) throw error;
            }
        }
        return items;
    }

    private item(o: OrganisationSummary, language: string): LookupItem {
        return {
            id: o.id,
            label: o.name[language === 'en' ? 'en' : 'am'] || o.name.am,
            // organisations are never merged or removed: a record the caller sees can be picked
            active: true,
            facts: [
                fact('kind', 'parties.field.kind', text(`parties.kind.${o.kind}`, language), language),
                fact('tin', 'parties.field.tin', o.tin, language),
                fact('licenceNumber', 'parties.field.licenceNumber', o.licenceNumber, language),
                fact('handlingUnit', 'parties.field.handlingUnit', unitText(o.handlingUnit, language), language)
            ]
        };
    }
}
