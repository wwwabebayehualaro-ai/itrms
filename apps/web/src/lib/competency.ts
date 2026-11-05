'use client';

/**
 * Driver licences (task 0.24c, `@itrms/competency`): queries and changes through the BFF. The screens are registry views: a licence
 * itself changes only through its case's workflow, on the platform's own case page.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Enrolment, Licence, LicenceGrade, LicenceStatus, PrintBatch } from '@itrms/competency/contracts';

import client from './api/client';

export type { Enrolment, Licence, LicenceGrade, LicenceStatus, PrintBatch };

const keys = {
    grades: ['competency', 'grades'] as const,
    licences: (filters: LicenceFilters) => ['competency', 'licences', filters] as const,
    enrolments: ['competency', 'enrolments'] as const,
    batches: ['competency', 'batches'] as const
};

export interface LicenceFilters {
    number?: string;
    status?: LicenceStatus;
}

export function useLicences(filters: LicenceFilters) {
    return useQuery({
        queryKey: keys.licences(filters),
        placeholderData: keepPreviousData,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: Licence[] }>('v1/competency/licences', { params: filters, signal })).data
    });
}

export function useGrades() {
    return useQuery({
        queryKey: keys.grades,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: LicenceGrade[] }>('v1/competency/grades', { signal })).data
    });
}

export function useEnrolments() {
    return useQuery({
        queryKey: keys.enrolments,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: Enrolment[] }>('v1/competency/training-enrolments', { signal })).data
    });
}

export function useEnrol() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { personId: string; schoolId: string; grade: string }) =>
            (await client.post<Enrolment>('v1/competency/training-enrolments', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: keys.enrolments })
    });
}

export function useCompleteEnrolment() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: string; version: number; completedOn: string }) =>
            (
                await client.post<Enrolment>(
                    `v1/competency/training-enrolments/${input.id}/completion`,
                    { completedOn: input.completedOn },
                    { headers: { 'If-Match': `"${input.version}"` } }
                )
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: keys.enrolments })
    });
}

export function usePrintBatches() {
    return useQuery({
        queryKey: keys.batches,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: PrintBatch[] }>('v1/competency/print-batches', { signal })).data
    });
}

export function useSendPrintBatch() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: string; version: number }) =>
            (
                await client.post<PrintBatch>(
                    `v1/competency/print-batches/${input.id}/sending`,
                    {},
                    { headers: { 'If-Match': `"${input.version}"` } }
                )
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: keys.batches })
    });
}

export interface LookupHit {
    id: string;
    label: string;
}

/** What a registry lookup finds, for a picker on these screens: the same providers a form's lookup field uses. */
export function useLookupSearch(provider: 'person' | 'training-school', q: string) {
    return useQuery({
        queryKey: ['competency', 'lookup', provider, q],
        enabled: q.trim().length > 0,
        placeholderData: keepPreviousData,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: LookupHit[] }>(`v1/registry-lookups/${provider}`, { params: { q }, signal }))
                .data
    });
}
