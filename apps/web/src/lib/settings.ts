'use client';
/**
 * The settings of a unit (task 0.21a, ADR-0026): each value with where it comes from, read with
 * `GET /api/v1/org-units/:id/settings`, and the unit's own value or the region's value for its type, set and reset with
 * the version read (If-Match; 0 while there is none). Another administrator's change since is refused (409), never
 * overwritten: the screen reads again.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import client from './api/client';
import { useAuthStore } from './auth/authStore';

type Text = Readonly<Partial<Record<string, string>>>;

export type SourceLevel = 'default' | 'installation' | 'region' | 'unit' | 'unitType' | 'user';

export interface SettingSource {
    level: SourceLevel;
    unitId?: string;
    unitTypeId?: string;
}

export interface SettingSchema {
    type?: string;
    enum?: string[];
    items?: { type?: string; enum?: string[] };
    minimum?: number;
    maximum?: number;
}

export interface UnitSetting {
    key: string;
    owner: string;
    name: Text;
    options: { value: string; name: Text | null }[] | null;
    overridableAt: string[];
    userPreference: boolean;
    sensitive: boolean;
    schema: SettingSchema;
    value: unknown;
    source: SettingSource;
    inherited: { value: unknown; source: SettingSource } | null;
    inheritedWithoutType: { value: unknown; source: SettingSource } | null;
    own: { value: unknown; version: number } | null;
    unitType: { value: unknown; version: number } | null;
    writable: { unit: boolean; unitType: boolean };
}

export interface UnitSettings {
    unitId: string;
    unitType: { id: string; name: Text } | null;
    units: { id: string; name: Text }[];
    settings: UnitSetting[];
}

export interface SubtreeUnit {
    id: string;
    code: string;
    name: Text;
    path: string;
}

const settingsKey = (unitId: string) => ['settings', unitId] as const;

export function useUnitSettings(unitId: string | undefined) {
    return useQuery({
        queryKey: settingsKey(unitId ?? ''),
        enabled: Boolean(unitId),
        queryFn: async ({ signal }) =>
            (await client.get<UnitSettings>(`v1/org-units/${unitId}/settings`, { signal })).data
    });
}

/** The units the person may look at: the one they act for and those below it. */
export function useSubtree(unitId: string | undefined) {
    return useQuery({
        queryKey: ['org-units', unitId, 'subtree'],
        enabled: Boolean(unitId),
        queryFn: async ({ signal }) =>
            (await client.get<SubtreeUnit[]>(`v1/org-units/${unitId}/subtree`, { signal })).data
    });
}

/** Where a change goes: the unit's own value, or the region's value for the unit's type. */
export type SettingTarget = { unitId: string } | { unitTypeId: string };

const urlOf = (target: SettingTarget, key: string) =>
    'unitId' in target
        ? `v1/org-units/${target.unitId}/settings/${key}`
        : `v1/unit-types/${target.unitTypeId}/settings/${key}`;

export interface SettingChange {
    target: SettingTarget;
    key: string;
    /** the version read (0: none of its own yet) */
    version: number;
    /** undefined: reset */
    value?: unknown;
}

/** Sets or resets a value; afterwards every unit's settings and the person's workspace are read again. */
export function useChangeSetting() {
    const queries = useQueryClient();
    const hydrate = useAuthStore((s) => s.hydrate);
    return useMutation({
        mutationFn: async ({ target, key, version, value }: SettingChange) => {
            const headers = { 'if-match': `"${version}"` };
            if (value === undefined) await client.delete(urlOf(target, key), { headers });
            else await client.put(urlOf(target, key), { value }, { headers });
        },
        onSettled: async () => {
            await Promise.all([queries.invalidateQueries({ queryKey: ['settings'] }), hydrate()]);
        }
    });
}
