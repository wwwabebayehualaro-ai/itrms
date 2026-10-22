/**
 * The register of people and organisations (architecture.md §8, ADR-0013, task 0.14). Regional records (class R): the
 * whole region reads them, the handling unit's subtree writes them; a transfer changes the handling unit, never copies.
 *
 *   persons             names in both scripts, sex, birth year, address: what every office may see.
 *   person_sensitive    full birth date, phone, Fayda FIN: encrypted per field (kernel FieldCrypto), with HMAC blind
 *                       indexes for exact search and duplicate checks; read back only through reveal(). The audit log
 *                       never holds a ciphertext and holds the indexes only HMAC-masked.
 *   organisations       associations, schools, contractors …, with their members.
 *   person_merges       a request to merge two records of one person, approved by a second person (class T).
 *
 * Names are searched through parties.search_persons (a scoped SECURITY DEFINER function, so the trigram index serves the
 * query under the region's scope), on `search_text`: the names of both scripts folded (foldForSearch).
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
    text,
    timestamp,
    uniqueIndex,
    uuid
} from 'drizzle-orm/pg-core';
import { bytea, orgUnits } from '@itrms/kernel/tables';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';

export const partiesSchema = pgSchema('parties');

const handling = () => ({
    regionId: uuid('region_id').notNull(),
    handlingUnitId: uuid('handling_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the handling unit */
    handlingOrgPath: ltree('handling_org_path').notNull().default('')
});

const address = () => ({
    addressUnitId: uuid('address_unit_id').references(() => orgUnits.id),
    kebele: text('kebele'),
    houseNumber: text('house_number')
});

export const persons = withRls(
    audited(
        partiesSchema.table(
            'persons',
            {
                ...baseColumns(),
                ...handling(),
                givenNameAm: text('given_name_am').notNull(),
                fatherNameAm: text('father_name_am').notNull(),
                grandfatherNameAm: text('grandfather_name_am'),
                givenNameEn: text('given_name_en'),
                fatherNameEn: text('father_name_en'),
                grandfatherNameEn: text('grandfather_name_en'),
                sex: text('sex', { enum: ['female', 'male'] }).notNull(),
                /** Gregorian */
                birthYear: integer('birth_year'),
                ...address(),
                status: text('status', { enum: ['active', 'merged'] })
                    .notNull()
                    .default('active'),
                mergedIntoId: uuid('merged_into_id'),
                /** both scripts' names, folded: for the trigram search only, never shown */
                searchText: text('search_text').notNull(),
                /** given + father name folded, per script: the duplicate check's exact name match */
                nameKeyAm: text('name_key_am').notNull(),
                nameKeyEn: text('name_key_en')
            },
            (t) => [
                index('persons_search_trgm').using('gin', sql`${t.searchText} gin_trgm_ops`),
                index('persons_region_name_am_idx').on(t.regionId, t.nameKeyAm),
                index('persons_region_name_en_idx').on(t.regionId, t.nameKeyEn),
                index('persons_handling_gist').using('gist', t.handlingOrgPath),
                check('persons_birth_year_check', sql`${t.birthYear} between 1900 and 2100`),
                check('persons_merged_check', sql`(${t.status} = 'merged') = (${t.mergedIntoId} is not null)`)
            ]
        )
    ),
    'registry'
);

export const personSensitive = withRls(
    audited(
        partiesSchema.table(
            'person_sensitive',
            {
                ...baseColumns(),
                ...handling(),
                personId: uuid('person_id')
                    .notNull()
                    .references(() => persons.id),
                birthDateCt: bytea('birth_date_ct'),
                phoneCt: bytea('phone_ct'),
                finCt: bytea('fin_ct'),
                birthDateBidx: bytea('birth_date_bidx'),
                phoneBidx: bytea('phone_bidx'),
                finBidx: bytea('fin_bidx'),
                /** its person was merged into another: its FIN no longer blocks the survivor's */
                merged: boolean('merged').notNull().default(false)
            },
            (t) => [
                uniqueIndex('person_sensitive_person_uq').on(t.personId),
                // one living record per Fayda number in a region
                uniqueIndex('person_sensitive_fin_uq')
                    .on(t.regionId, t.finBidx)
                    .where(sql`${t.finBidx} is not null and not ${t.merged}`),
                index('person_sensitive_phone_idx').on(t.regionId, t.phoneBidx),
                index('person_sensitive_birth_date_idx').on(t.regionId, t.birthDateBidx)
            ]
        ),
        {
            omit: ['birthDateCt', 'phoneCt', 'finCt'],
            mask: ['birthDateBidx', 'phoneBidx', 'finBidx']
        }
    ),
    'registry'
);

export const organisations = withRls(
    audited(
        partiesSchema.table(
            'organisations',
            {
                ...baseColumns(),
                ...handling(),
                kind: text('kind').notNull(),
                /** I18nText: Amharic and English required */
                name: jsonb('name').$type<{ am: string; en: string }>().notNull(),
                tin: text('tin'),
                licenceNumber: text('licence_number'),
                ...address(),
                searchText: text('search_text').notNull()
            },
            (t) => [
                uniqueIndex('organisations_tin_uq')
                    .on(t.regionId, t.tin)
                    .where(sql`${t.tin} is not null`),
                index('organisations_search_trgm').using('gin', sql`${t.searchText} gin_trgm_ops`),
                index('organisations_handling_gist').using('gist', t.handlingOrgPath)
            ]
        )
    ),
    'registry'
);

export const organisationMembers = withRls(
    audited(
        partiesSchema.table(
            'organisation_members',
            {
                ...baseColumns(),
                ...handling(),
                organisationId: uuid('organisation_id')
                    .notNull()
                    .references(() => organisations.id),
                personId: uuid('person_id')
                    .notNull()
                    .references(() => persons.id),
                role: text('role').notNull(),
                since: date('since'),
                until: date('until')
            },
            (t) => [
                index('organisation_members_org_idx').on(t.organisationId),
                index('organisation_members_person_idx').on(t.personId)
            ]
        )
    ),
    'registry'
);

export const personMerges = withRls(
    audited(
        partiesSchema.table(
            'person_merges',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                /** the unit that asked: its subtree sees the request, its heads (or above) decide */
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                survivorId: uuid('survivor_id')
                    .notNull()
                    .references(() => persons.id),
                duplicateId: uuid('duplicate_id')
                    .notNull()
                    .references(() => persons.id),
                reason: text('reason').notNull(),
                status: text('status', { enum: ['pending', 'approved', 'rejected'] })
                    .notNull()
                    .default('pending'),
                decidedBy: uuid('decided_by'),
                decidedAt: timestamp('decided_at', { withTimezone: true }),
                note: text('note')
            },
            (t) => [
                // one open request per duplicate record
                uniqueIndex('person_merges_pending_uq')
                    .on(t.duplicateId)
                    .where(sql`${t.status} = 'pending'`),
                index('person_merges_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);
