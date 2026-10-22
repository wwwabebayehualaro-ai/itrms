'use client';

/**
 * The register of people and organisations (task 0.14, `@itrms/parties`): queries and changes through the BFF. The types
 * come from the slice's contracts, so the screens and the API share one definition. A FIN or phone search is a POST: a
 * sensitive value never goes into a URL.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    DuplicateList,
    Person,
    PersonCreate,
    PersonSummary,
    PersonUpdate,
    SensitiveField,
    duplicateCheckSchema,
    memberAddSchema,
    mergeSchema,
    organisationCreateSchema,
    organisationListSchema,
    organisationSchema,
    personCreateSchema,
    personUpdateSchema
} from '@itrms/parties/contracts';
import type { z } from 'zod';

import client from './api/client';
import { createKeys } from './query/keys';

export type Merge = z.infer<typeof mergeSchema>;
export type Organisation = z.infer<typeof organisationSchema>;
export type OrganisationSummary = z.infer<typeof organisationListSchema>['items'][number];
export type { DuplicateList, Person, PersonCreate, PersonSummary, PersonUpdate, SensitiveField };

export const personKeys = createKeys('persons');
export const mergeKeys = createKeys('person-merges');
export const organisationKeys = createKeys('organisations');

const ifMatch = (version: number) => ({ headers: { 'if-match': `"${version}"` } });

/** Persons whose names hold every word of `q` (either script); nothing until two letters are typed. */
export function usePersonSearch(q: string) {
    const query = q.trim();
    return useQuery({
        queryKey: personKeys.list({ q: query }),
        enabled: query.length >= 2,
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: PersonSummary[] }>('v1/persons', {
                    params: { q: query, limit: 20 },
                    signal
                })
            ).data.items
    });
}

/** Persons with this exact FIN or phone. */
export function usePersonLookup() {
    return useMutation({
        mutationFn: async (by: { fin?: string; phone?: string }) =>
            (await client.post<{ items: PersonSummary[] }>('v1/persons/lookup', by)).data.items
    });
}

export function usePerson(id: string) {
    return useQuery({
        queryKey: personKeys.detail(id),
        queryFn: async ({ signal }) => (await client.get<Person>(`v1/persons/${id}`, { signal })).data
    });
}

export function useDuplicateCheck() {
    return useMutation({
        mutationFn: async (input: z.input<typeof duplicateCheckSchema>) =>
            (await client.post<DuplicateList>('v1/persons/duplicates', input)).data
    });
}

export function useCreatePerson() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: z.input<typeof personCreateSchema>) =>
            (await client.post<Person>('v1/persons', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: personKeys.lists() })
    });
}

export function useUpdatePerson(id: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async ({ version, changes }: { version: number; changes: z.input<typeof personUpdateSchema> }) =>
            (await client.patch<Person>(`v1/persons/${id}`, changes, ifMatch(version))).data,
        onSuccess: (person) => {
            queries.setQueryData(personKeys.detail(id), person);
            void queries.invalidateQueries({ queryKey: personKeys.lists() });
        }
    });
}

/** The sensitive fields in clear: kept on this screen only, never cached (gone from memory once the screen is left). */
export function useReveal(id: string) {
    return useMutation({
        gcTime: 0,
        mutationFn: async (input: { fields: SensitiveField[]; reason: string }) =>
            (await client.post<Partial<Record<SensitiveField, string | null>>>(`v1/persons/${id}/reveal`, input)).data
    });
}

export function useMerges(status: Merge['status'] = 'pending') {
    return useQuery({
        queryKey: mergeKeys.list({ status }),
        queryFn: async ({ signal }) =>
            (await client.get<{ items: Merge[] }>('v1/person-merges', { params: { status }, signal })).data.items
    });
}

export function useRequestMerge() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { survivorId: string; duplicateId: string; reason: string }) =>
            (await client.post<Merge>('v1/person-merges', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: mergeKeys.all })
    });
}

export function useDecideMerge() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async ({ merge, approve, note }: { merge: Merge; approve: boolean; note?: string }) =>
            (
                await client.post<Merge>(
                    `v1/person-merges/${merge.id}/${approve ? 'approval' : 'rejection'}`,
                    note ? { note } : {},
                    ifMatch(merge.version)
                )
            ).data,
        onSuccess: () => {
            void queries.invalidateQueries({ queryKey: mergeKeys.all });
            void queries.invalidateQueries({ queryKey: personKeys.all });
        }
    });
}

export function useOrganisations(q: string) {
    const query = q.trim();
    return useQuery({
        queryKey: organisationKeys.list({ q: query }),
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: OrganisationSummary[] }>('v1/organisations', {
                    params: query.length >= 2 ? { q: query, limit: 20 } : { limit: 20 },
                    signal
                })
            ).data.items
    });
}

export function useOrganisation(id: string) {
    return useQuery({
        queryKey: organisationKeys.detail(id),
        queryFn: async ({ signal }) => (await client.get<Organisation>(`v1/organisations/${id}`, { signal })).data
    });
}

export function useCreateOrganisation() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: z.input<typeof organisationCreateSchema>) =>
            (await client.post<Organisation>('v1/organisations', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: organisationKeys.lists() })
    });
}

export function useAddMember(id: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: z.input<typeof memberAddSchema>) =>
            (await client.post<Organisation>(`v1/organisations/${id}/members`, input)).data,
        onSuccess: (organisation) => queries.setQueryData(organisationKeys.detail(id), organisation)
    });
}

/** The units offered as an address: the active unit and those below it (a region-wide picker comes with kebeles). */
export function useAddressUnits(unitId: string | undefined) {
    return useQuery({
        queryKey: ['org-units', 'subtree', unitId],
        enabled: Boolean(unitId),
        queryFn: async ({ signal }) =>
            (
                await client.get<{ id: string; code: string; name: Record<string, string>; depth?: number }[]>(
                    `v1/org-units/${unitId}/subtree`,
                    { signal }
                )
            ).data
    });
}
