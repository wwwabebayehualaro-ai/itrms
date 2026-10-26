/**
 * The register of organisations (task 0.14): associations, training schools, contractors … with their TIN, licence and
 * address, and their members (persons of the register, by role, from a date until a date). Regional records, written by
 * the handling office.
 */
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { insertAudited, newId, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { foldForSearch } from '@itrms/schemas';
import type { z } from 'zod';

import type {
    memberAddSchema,
    organisationCreateSchema,
    organisationListSchema,
    organisationSchema,
    organisationUpdateSchema
} from '../contracts';
import { organisationMembers, organisations } from './parties.table';
import { PersonsService } from './persons.service';
import { isUniqueViolation, required, unitRefs, withinScope, type UnitRef } from './support';

type Organisation = z.infer<typeof organisationSchema>;
type OrganisationSummary = z.infer<typeof organisationListSchema>['items'][number];
type Row = typeof organisations.$inferSelect;

const searchTextOf = (name: { am: string; en: string }) => foldForSearch(`${name.am} ${name.en}`);

@Injectable()
export class OrganisationsService {
    constructor(@Inject(PersonsService) private readonly persons: PersonsService) {}

    async get(tx: Tx, id: string): Promise<Organisation> {
        const [row] = await tx.select().from(organisations).where(eq(organisations.id, id));
        if (!row) throw new NotFoundError();
        const members = await tx
            .select()
            .from(organisationMembers)
            .where(eq(organisationMembers.organisationId, id))
            .orderBy(organisationMembers.createdAt);
        const people = new Map(
            (
                await this.persons.summaries(
                    tx,
                    members.map((m) => m.personId)
                )
            ).map((p) => [p.id, p])
        );
        const units = await unitRefs(tx, [row.handlingUnitId, row.addressUnitId]);
        return {
            ...summaryOf(row, units),
            members: members.flatMap((m) => {
                const person = people.get(m.personId);
                return person
                    ? [
                          {
                              id: m.id,
                              version: m.rowVersion,
                              person,
                              role: m.role as Organisation['members'][number]['role'],
                              since: m.since,
                              until: m.until
                          }
                      ]
                    : [];
            })
        };
    }

    /** The organisations among `ids` the caller's scope shows (one query under RLS), without their members. */
    async summaries(tx: Tx, ids: readonly string[]): Promise<OrganisationSummary[]> {
        const wanted = [...new Set(ids)];
        if (wanted.length === 0) return [];
        const rows = await tx.select().from(organisations).where(inArray(organisations.id, wanted));
        const units = await unitRefs(
            tx,
            rows.flatMap((r) => [r.handlingUnitId, r.addressUnitId])
        );
        return rows.map((r) => summaryOf(r, units));
    }

    /** By name (either language, folded) or TIN; without a query, the latest registered. */
    async search(tx: Tx, q: string | undefined, limit: number): Promise<OrganisationSummary[]> {
        let ids: string[];
        if (q) {
            const result = await tx.execute<{ organisation_id: string }>(
                sql`select organisation_id from parties.search_organisations(${foldForSearch(q)}, ${limit})`
            );
            ids = result.rows.map((r) => r.organisation_id);
        } else
            ids = (
                await tx
                    .select({ id: organisations.id })
                    .from(organisations)
                    .orderBy(desc(organisations.createdAt))
                    .limit(limit)
            ).map((r) => r.id);
        if (ids.length === 0) return [];
        const rows = await tx.select().from(organisations).where(inArray(organisations.id, ids));
        const units = await unitRefs(
            tx,
            rows.flatMap((r) => [r.handlingUnitId, r.addressUnitId])
        );
        const byId = new Map(rows.map((r) => [r.id, summaryOf(r, units)]));
        return ids.flatMap((id) => byId.get(id) ?? []);
    }

    async create(tx: Tx, ctx: DbContext, input: z.infer<typeof organisationCreateSchema>): Promise<Organisation> {
        await this.checkAddress(tx, input.address?.unitId);
        const id = newId();
        await this.guardTin(() =>
            insertAudited(tx, organisations, {
                id,
                regionId: required(ctx.regionId),
                handlingUnitId: required(ctx.unitId),
                kind: input.kind,
                name: input.name,
                tin: input.tin ?? null,
                licenceNumber: input.licenceNumber ?? null,
                addressUnitId: input.address?.unitId ?? null,
                kebele: input.address?.kebele ?? null,
                houseNumber: input.address?.houseNumber ?? null,
                searchText: searchTextOf(input.name)
            })
        );
        return this.get(tx, id);
    }

    async update(
        tx: Tx,
        ctx: DbContext,
        id: string,
        version: number,
        input: z.infer<typeof organisationUpdateSchema>
    ): Promise<Organisation> {
        const current = await this.writable(tx, ctx, id);
        if (input.address) await this.checkAddress(tx, input.address.unitId);
        const changes: Partial<typeof organisations.$inferInsert> = {};
        if (input.kind !== undefined) changes.kind = input.kind;
        if (input.name !== undefined) {
            changes.name = input.name;
            changes.searchText = searchTextOf(input.name);
        }
        if (input.tin !== undefined) changes.tin = input.tin;
        if (input.licenceNumber !== undefined) changes.licenceNumber = input.licenceNumber;
        if (input.address !== undefined) {
            changes.addressUnitId = input.address?.unitId ?? null;
            changes.kebele = input.address?.kebele ?? null;
            changes.houseNumber = input.address?.houseNumber ?? null;
        }
        await this.guardTin(() => updateAudited(tx, organisations, current.id, version, changes));
        return this.get(tx, id);
    }

    async addMember(tx: Tx, ctx: DbContext, id: string, input: z.infer<typeof memberAddSchema>): Promise<Organisation> {
        const organisation = await this.writable(tx, ctx, id);
        const [person] = await this.persons.summaries(tx, [input.personId]);
        if (!person) throw new NotFoundError();
        if (person.status !== 'active')
            throw new ConflictError('invalid_transition', { detail: 'This record was merged into another.' });
        try {
            await insertAudited(tx, organisationMembers, {
                regionId: organisation.regionId,
                handlingUnitId: organisation.handlingUnitId,
                organisationId: id,
                personId: input.personId,
                role: input.role,
                since: input.since ?? null
            });
        } catch (error) {
            if (isUniqueViolation(error, 'organisation_members_open_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: 'This person already holds this role here.',
                    cause: error
                });
            throw error;
        }
        return this.get(tx, id);
    }

    /** A membership ends on a date; it is never deleted. */
    async endMember(
        tx: Tx,
        ctx: DbContext,
        id: string,
        memberId: string,
        version: number,
        until: string
    ): Promise<Organisation> {
        await this.writable(tx, ctx, id);
        const [member] = await tx.select().from(organisationMembers).where(eq(organisationMembers.id, memberId));
        if (!member || member.organisationId !== id) throw new NotFoundError();
        if (member.until) throw new ConflictError('invalid_transition', { detail: 'This membership already ended.' });
        if (member.since && until < member.since)
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'until', code: 'custom', message: 'is before the membership began' }]
            });
        await updateAudited(tx, organisationMembers, memberId, version, { until });
        return this.get(tx, id);
    }

    private async writable(tx: Tx, ctx: DbContext, id: string): Promise<Row> {
        const [row] = await tx.select().from(organisations).where(eq(organisations.id, id));
        if (!row) throw new NotFoundError();
        if (!withinScope(row.handlingOrgPath, ctx.scopePath ?? ''))
            throw new ForbiddenError({ detail: 'This record is handled by another office.' });
        return row;
    }

    private async checkAddress(tx: Tx, unitId: string | undefined) {
        if (!unitId) return;
        if (!(await unitRefs(tx, [unitId])).has(unitId))
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'address.unitId', code: 'custom', message: 'not a unit of this region' }]
            });
    }

    private async guardTin<T>(write: () => Promise<T>): Promise<T> {
        try {
            return await write();
        } catch (error) {
            if (isUniqueViolation(error, 'organisations_tin_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: 'An organisation with this TIN is registered.',
                    cause: error
                });
            throw error;
        }
    }
}

function summaryOf(row: Row, units: ReadonlyMap<string, UnitRef>): OrganisationSummary {
    const ref = (id: string): UnitRef => units.get(id) ?? { id, code: '', name: {} };
    return {
        id: row.id,
        version: row.rowVersion,
        kind: row.kind as OrganisationSummary['kind'],
        name: row.name,
        tin: row.tin,
        licenceNumber: row.licenceNumber,
        address: row.addressUnitId
            ? { unit: ref(row.addressUnitId), kebele: row.kebele, houseNumber: row.houseNumber }
            : null,
        handlingUnit: ref(row.handlingUnitId),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
    };
}
