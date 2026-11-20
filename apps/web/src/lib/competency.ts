'use client';

/**
 * Driver licences (task 0.24c, `@itrms/competency`): queries and changes through the BFF. The screens are registry views: a licence
 * itself changes only through its case's workflow, on the platform's own case page.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    BloodGroup,
    Enrolment,
    ENROLMENT_STATUSES,
    Licence,
    LicenceHealthRevealed,
    LicenceGrade,
    LicenceStatus,
    MedicalConditionsRevealed,
    MedicalReport,
    PrintBatch
} from '@itrms/competency/contracts';

import client from './api/client';

export type {
    BloodGroup,
    Enrolment,
    Licence,
    LicenceGrade,
    LicenceHealthRevealed,
    LicenceStatus,
    MedicalConditionsRevealed,
    MedicalReport,
    PrintBatch
};

/** What the lists ask for at once. The screens say when there may be more, and how to narrow them. */
export const LIST_LIMIT = 50;

export interface LicenceFilters {
    number?: string;
    cardSerial?: string;
    personId?: string;
    status?: LicenceStatus;
}

export interface EnrolmentFilters {
    personId?: string;
    status?: (typeof ENROLMENT_STATUSES)[number];
}

const keys = {
    grades: ['competency', 'grades'] as const,
    licences: (filters: LicenceFilters) => ['competency', 'licences', filters] as const,
    enrolments: ['competency', 'enrolments'] as const,
    batches: ['competency', 'batches'] as const
};

export function useLicences(filters: LicenceFilters) {
    return useQuery({
        queryKey: keys.licences(filters),
        placeholderData: keepPreviousData,
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: Licence[] }>('v1/competency/licences', {
                    params: { ...filters, limit: LIST_LIMIT },
                    signal
                })
            ).data
    });
}

/** The holder's blood group for the card (task 1.6): the answer is the licence, which says only that one is on record. */
export function useRecordBloodGroup() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: string; bloodGroup: BloodGroup }) =>
            (await client.post<Licence>(`v1/competency/licences/${input.id}/health`, { bloodGroup: input.bloodGroup }))
                .data,
        onSuccess: () => queries.invalidateQueries({ queryKey: ['competency', 'licences'] })
    });
}

/** The blood group in clear, with a reason (the audited reveal, ADR-0052). Never cached: it is gone when the screen is left. */
export async function revealBloodGroup(id: string, reason: string): Promise<LicenceHealthRevealed> {
    return (await client.post<LicenceHealthRevealed>(`v1/competency/licences/${id}/health/reveal`, { reason })).data;
}

/** A renewal's medical reports (task 1.6a): whether conditions are on record, never what they are. */
export function useMedicalReports(caseId: string, enabled = true) {
    return useQuery({
        queryKey: ['competency', 'medical-reports', caseId],
        enabled,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: MedicalReport[] }>(`v1/competency/cases/${caseId}/medical-reports`, { signal }))
                .data
    });
}

export function useRecordMedicalConditions(caseId: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: string; conditions: string }) =>
            (
                await client.post<MedicalReport>(`v1/competency/medical-reports/${input.id}/conditions`, {
                    conditions: input.conditions
                })
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: ['competency', 'medical-reports', caseId] })
    });
}

/** The conditions in clear, with a reason (the audited reveal, ADR-0064 §4). Never cached: gone when the screen is left. */
export async function revealMedicalConditions(id: string, reason: string): Promise<MedicalConditionsRevealed> {
    return (
        await client.post<MedicalConditionsRevealed>(`v1/competency/medical-reports/${id}/conditions/reveal`, {
            reason
        })
    ).data;
}

/** The catalogue, for whoever enters a training list: reading it asks for `licence:read`, which they have. */
export function useGrades(enabled = true) {
    return useQuery({
        queryKey: keys.grades,
        enabled,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: LicenceGrade[] }>('v1/competency/grades', { signal })).data
    });
}

export function useEnrolments(filters: EnrolmentFilters = {}) {
    return useQuery({
        queryKey: [...keys.enrolments, filters],
        placeholderData: keepPreviousData,
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: Enrolment[] }>('v1/competency/training-enrolments', {
                    params: { ...filters, limit: LIST_LIMIT },
                    signal
                })
            ).data
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
    return useQuery<{ items: PrintBatch[] }>({
        queryKey: keys.batches,
        // a batch on its way moves on in the worker: the screen follows until it has
        refetchInterval: (query) => (query.state.data?.items.some((b) => b.status === 'requested') ? 5_000 : false),
        queryFn: async ({ signal }) =>
            (await client.get<{ items: PrintBatch[] }>('v1/competency/print-batches', { signal })).data
    });
}

/** A sent batch came back printed: its licences on consecutive card blanks from the first one (task 1.12a). */
export function useRecordPrinted() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: string; version: number; firstCardKey: string }) =>
            (
                await client.post<PrintBatch>(
                    `v1/competency/print-batches/${input.id}/printing`,
                    { firstCardKey: input.firstCardKey },
                    { headers: { 'If-Match': `"${input.version}"` } }
                )
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: keys.batches })
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
