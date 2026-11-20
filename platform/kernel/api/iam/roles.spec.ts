/**
 * What a role grant adds (ADR-0065): a module's permission on another module's role, where its setting is on for the active unit.
 */
import { describe, expect, it } from 'vitest';

import { grantedPermissions, type RoleGrant } from './roles';

const GRANTS: RoleGrant[] = [
    { role: 'records_officer', permissions: ['licence:read'], setting: 'competency.intake_reads_licences' },
    { role: 'cashier', permissions: ['permit:read'], setting: 'freight.cashier_reads_permits' }
];

describe('a role grant', () => {
    it('adds its permissions to a held role whose setting is true, and reads no setting for a role not held', async () => {
        const read: string[] = [];
        const settings = (values: Record<string, unknown>) => (key: string) => {
            read.push(key);
            return Promise.resolve(values[key]);
        };
        const on = settings({ 'competency.intake_reads_licences': true, 'freight.cashier_reads_permits': true });
        expect([...(await grantedPermissions(GRANTS, ['records_officer'], on))]).toEqual(['licence:read']);
        expect(read).toEqual(['competency.intake_reads_licences']);
        expect([...(await grantedPermissions(GRANTS, ['unit_head'], on))]).toEqual([]);
    });

    it('adds nothing where its setting is off, missing or not exactly true', async () => {
        for (const value of [false, undefined, 'true', 1, null])
            expect(
                [...(await grantedPermissions(GRANTS, ['records_officer'], () => Promise.resolve(value as unknown)))],
                String(value)
            ).toEqual([]);
    });
});
