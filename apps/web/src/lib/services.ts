'use client';
/**
 * The service catalogue (tasks 0.21b, 0.21c): the region's services and what this office offers, a service's versions
 * and publishing one, an office's configuration and its override (If-Match; 0 while it has none), and a request at the
 * counter (`POST /api/v1/service-requests`: the case starts on the configuration frozen for the office, with the request
 * form's answers). The workflows a version may name, renamed or switched off.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import client from './api/client';

type Text = Readonly<Partial<Record<string, string>>>;

export interface ServiceSummary {
    code: string;
    name: Text;
    process: number;
    module: string;
    configured: boolean;
    enabled: boolean;
    currentVersion: number | null;
}

export type OverrideFamily = 'sla' | 'approval_unit' | 'help' | 'templateHeader';
export type OverrideLevel = 'region' | 'unit';
export const OVERRIDE_FAMILIES: OverrideFamily[] = ['sla', 'help', 'approval_unit', 'templateHeader'];
export const OVERRIDE_LEVELS: OverrideLevel[] = ['region', 'unit'];

export interface ServiceVersion {
    id: string;
    number: number;
    formVersionId: string | null;
    workflowVersionId: string;
    defaults: Record<string, unknown>;
    overridePolicy: Partial<Record<OverrideFamily, OverrideLevel[]>>;
    effectiveFrom: string;
    note: string | null;
    publishedAt: string;
}

export interface OverrideConflict {
    unitId: string;
    unitName: Text;
    key: string;
    problem: 'not_allowed' | 'unknown_state' | 'unknown_field' | 'invalid_value';
}

export interface Source {
    level: 'default' | 'region' | 'unit';
    unitId?: string;
}

export interface ServiceConfiguration {
    serviceCode: string;
    version: ServiceVersion;
    /** the workflow steps a time limit may be set for, and the request form's fields */
    states: { key: string; label: Text | null }[];
    fields: string[];
    values: Record<string, { value: unknown; source: Source }>;
    own: { values: Record<string, unknown>; reason: string; version: number } | null;
    problems: { key: string; problem: OverrideConflict['problem'] }[];
    writable: boolean;
}

export interface Sla {
    businessHours?: number;
    businessDays?: number;
}

export interface RequestForm {
    serviceCode: string;
    name: Text;
    versionNumber: number;
    form: { formId: string; versionId: string } | null;
    help: Record<string, Text>;
}

export const useServices = () =>
    useQuery({
        queryKey: ['services'],
        queryFn: async ({ signal }) => (await client.get<ServiceSummary[]>('v1/services', { signal })).data
    });

export const useServiceVersions = (code: string) =>
    useQuery({
        queryKey: ['services', code, 'versions'],
        queryFn: async ({ signal }) =>
            (await client.get<ServiceVersion[]>(`v1/services/${code}/versions`, { signal })).data
    });

export interface PublishInput {
    workflowVersionId: string;
    formVersionId: string | null;
    overridePolicy: Partial<Record<OverrideFamily, OverrideLevel[]>>;
    defaults?: Record<string, unknown>;
    effectiveFrom?: string;
}

export function usePublishVersion(code: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: PublishInput) =>
            (
                await client.post<{ version: ServiceVersion; conflicts: OverrideConflict[] }>(
                    `v1/services/${code}/versions`,
                    input
                )
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: ['services'] })
    });
}

export const useServiceConfiguration = (unitId: string | undefined, code: string) =>
    useQuery({
        queryKey: ['services', code, 'configuration', unitId],
        enabled: Boolean(unitId),
        retry: false,
        queryFn: async ({ signal }) =>
            (
                await client.get<ServiceConfiguration>(`v1/org-units/${unitId}/services/${code}/configuration`, {
                    signal
                })
            ).data
    });

export interface OverrideChange {
    unitId: string;
    /** the version read (0: none of its own yet) */
    version: number;
    /** undefined: reset */
    values?: Record<string, unknown>;
    reason?: string;
}

export function useChangeOverride(code: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async ({ unitId, version, values, reason }: OverrideChange) => {
            const url = `v1/org-units/${unitId}/services/${code}/override`;
            const headers = { 'if-match': `"${version}"` };
            if (values === undefined) await client.delete(url, { headers });
            else await client.put(url, { values, reason }, { headers });
        },
        onSettled: () => queries.invalidateQueries({ queryKey: ['services', code, 'configuration'] })
    });
}

export const useRequestForm = (code: string | undefined) =>
    useQuery({
        queryKey: ['services', code, 'request'],
        enabled: Boolean(code),
        retry: false,
        queryFn: async ({ signal }) => (await client.get<RequestForm>(`v1/services/${code}/request`, { signal })).data
    });

export const fileRequest = async (serviceCode: string, answers?: Record<string, unknown>) =>
    (await client.post<{ id: string; number: number }>('v1/service-requests', { serviceCode, answers })).data;

// --- the workflows a version names (the workflow slice's API) ------------------------------------------------------

export interface WorkflowSummary {
    id: string;
    version: number;
    key: string;
    name: Text;
    active: boolean;
    ownerUnit: { id: string; code: string; name: Text };
    latestVersion: { id: string; number: number } | null;
}

export const useWorkflows = () =>
    useQuery({
        queryKey: ['workflow-definitions'],
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: WorkflowSummary[] }>('v1/workflow-definitions', {
                    params: { limit: 100 },
                    signal
                })
            ).data.items
    });

export function useSwitchWorkflow() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, version, active }: { id: string; version: number; active: boolean }) =>
            client.patch(`v1/workflow-definitions/${id}`, { active }, { headers: { 'if-match': `"${version}"` } }),
        onSettled: () => queries.invalidateQueries({ queryKey: ['workflow-definitions'] })
    });
}

export const checkDefinition = async (definition: unknown) =>
    (
        await client.post<{ ok: boolean; problems: { code: string; path: string; message: string }[] }>(
            'v1/workflow-definitions/check',
            { definition }
        )
    ).data;

export interface WorkflowVersion {
    id: string;
    number: number;
    definition: { states?: { key: string; kind: string; label?: Text }[] };
}

export const useWorkflowVersion = (id: string | undefined, versionId: string | undefined) =>
    useQuery({
        queryKey: ['workflow-definitions', id, 'version', versionId],
        enabled: Boolean(id && versionId),
        staleTime: Infinity,
        queryFn: async ({ signal }) =>
            (await client.get<WorkflowVersion>(`v1/workflow-definitions/${id}/versions/${versionId}`, { signal })).data
    });

/** One form version's document (the counter's request form, a step's form): versions never change. */
export const useFormVersion = (form: { formId: string; versionId: string } | null | undefined) =>
    useQuery({
        queryKey: ['forms', form?.formId, 'version', form?.versionId],
        enabled: Boolean(form),
        staleTime: Infinity,
        queryFn: async ({ signal }) =>
            (
                await client.get<{ document: unknown }>(`v1/forms/${form?.formId}/versions/${form?.versionId}`, {
                    signal
                })
            ).data
    });

// --- the forms a version may name ----------------------------------------------------------------------------------

export interface FormSummary {
    id: string;
    key: string;
    name: Text;
    active: boolean;
    ownerUnit: { id: string };
    publishedVersion: { id: string; number: number } | null;
}

export const usePublishedForms = () =>
    useQuery({
        queryKey: ['forms', 'published'],
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: FormSummary[] }>('v1/forms', { params: { limit: 100 }, signal })
            ).data.items.filter((f) => f.active && f.publishedVersion)
    });
