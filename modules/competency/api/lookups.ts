/**
 * The form lookups of this slice (task 0.24a): a licence, picked by its number or its holder; and a training school, an organisation
 * of that kind. Facts under a pick are what a counter clerk needs and no more.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { LookupItem, RegistryLookupProvider } from '@itrms/forms/api';
import type { Tx } from '@itrms/kernel/db';
import { organisations } from '@itrms/parties/api';

import type { Licence } from '../contracts';
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
    readonly permission = 'licence:read';

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

@Injectable()
export class TrainingSchoolLookup implements RegistryLookupProvider {
    readonly key = 'training-school';
    readonly permission = 'organisation:read';

    title(language: string): string {
        return text('competency.lookup.school.title', language);
    }

    facts(): { key: string; label: string }[] {
        return [];
    }

    private item(school: { id: string; name: Record<string, string> }, language: string): LookupItem {
        return { id: school.id, active: true, label: school.name[language] ?? school.name.am ?? '', facts: [] };
    }

    async search(tx: Tx, q: string, limit: number, language: string): Promise<LookupItem[]> {
        const needle = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
        const schools = await tx
            .select({ id: organisations.id, name: organisations.name })
            .from(organisations)
            .where(
                and(
                    eq(organisations.kind, 'training_school'),
                    sql`(${organisations.name}->>'am' ilike ${needle} or ${organisations.name}->>'en' ilike ${needle})`
                )
            )
            .limit(limit);
        return schools.map((s) => this.item(s, language));
    }

    async resolve(tx: Tx, ids: readonly string[], language: string): Promise<LookupItem[]> {
        if (ids.length === 0) return [];
        const schools = await tx
            .select({ id: organisations.id, name: organisations.name })
            .from(organisations)
            .where(and(eq(organisations.kind, 'training_school'), inArray(organisations.id, [...ids])));
        return schools.map((s) => this.item(s, language));
    }
}
