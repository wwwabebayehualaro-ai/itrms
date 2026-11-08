import { describe, expect, it } from 'vitest';

import { configValuesSchema, overridePolicySchema } from '../contracts';
import {
    allowedBy,
    frozenConfig,
    keyProblem,
    requiresSettled,
    resolveConfig,
    unpaidGiving,
    type VersionConfig
} from './configuration';

const help = (en: string) => ({ am: `${en} (am)`, en });
const facts = { timedStates: new Set(['review', 'approval']), fieldKeys: new Set(['plate', 'remark']) };
const version: VersionConfig = {
    defaults: {
        'sla.review': { businessHours: 8 },
        'help.plate': help('The plate as written'),
        approval_unit: 'parent'
    },
    policy: overridePolicySchema.parse({ sla: ['region', 'unit'], help: ['unit'] }),
    facts
};
const unit = (unitId: string, values: Record<string, unknown> = {}) => ({
    unitId,
    values: new Map(Object.entries(values))
});

describe("a service's configuration for a unit", () => {
    it('takes the nearest allowed value: the woreda over the zone over the region over the version', () => {
        const resolved = resolveConfig(version, [
            unit('region', { 'sla.review': { businessHours: 16 } }),
            unit('zone', { 'sla.review': { businessHours: 12 } }),
            unit('damot', { 'sla.review': { businessDays: 2 }, 'help.remark': help('Why it is late') })
        ]);
        expect(resolved.get('sla.review')).toEqual({
            value: { businessDays: 2 },
            source: { level: 'unit', unitId: 'damot' }
        });
        expect(resolved.get('help.remark')?.source).toEqual({ level: 'unit', unitId: 'damot' });
        // the bureau's own value where nobody below changed it
        expect(resolved.get('help.plate')?.source).toEqual({ level: 'default' });
        // a sibling office keeps the zone's
        const boditi = resolveConfig(version, [
            unit('region'),
            unit('zone', { 'sla.review': { businessHours: 12 } }),
            unit('boditi')
        ]);
        expect(boditi.get('sla.review')?.value).toEqual({ businessHours: 12 });
    });

    it('passes over a key the policy does not allow at that level, or one the version no longer has', () => {
        const resolved = resolveConfig(version, [
            // help texts are a unit's, not the region's; the approval unit is nobody's to change
            unit('region', { 'help.plate': help('Region'), approval_unit: 'region' }),
            unit('damot', { 'sla.payment': { businessHours: 4 }, 'help.gone': help('A field no longer there') })
        ]);
        expect(resolved.get('help.plate')?.source).toEqual({ level: 'default' });
        expect(resolved.get('approval_unit')).toEqual({ value: 'parent', source: { level: 'default' } });
        expect(resolved.has('sla.payment')).toBe(false);
        expect(resolved.has('help.gone')).toBe(false);
    });

    it('names what is wrong with a key: not allowed, an unknown state or field, an invalid value', () => {
        const p = (key: string, value: unknown, level: 'default' | 'region' | 'unit' = 'unit') =>
            keyProblem(key, value, facts, version.policy, level);
        expect(p('sla.review', { businessHours: 4 })).toBeUndefined();
        expect(p('approval_unit', 'region')).toBe('not_allowed');
        expect(p('help.plate', help('x'), 'region')).toBe('not_allowed');
        expect(p('sla.payment', { businessHours: 4 })).toBe('unknown_state');
        expect(p('help.colour', help('x'))).toBe('unknown_field');
        expect(p('sla.review', { businessHours: 4, businessDays: 1 })).toBe('invalid_value');
        expect(p('help.plate', { en: 'English only' })).toBe('invalid_value');
        // the version's own defaults need no policy
        expect(p('approval_unit', 'region', 'default')).toBeUndefined();
        expect(allowedBy(version.policy, 'sla.review', 'user')).toBe(false);
    });

    it('freezes the values by family, with where each came from and the versions the case runs on', () => {
        const resolved = resolveConfig(version, [
            unit('region'),
            unit('damot', { 'sla.review': { businessHours: 4 } })
        ]);
        expect(
            frozenConfig(resolved, { serviceCode: 'RS-01', serviceVersionId: 'v1', formVersionId: null, inputMap: {} })
        ).toEqual({
            serviceCode: 'RS-01',
            serviceVersionId: 'v1',
            formVersionId: null,
            inputMap: {},
            approval_unit: 'parent',
            sla: { review: { businessHours: 4 } },
            help: { plate: help('The plate as written') },
            sources: {
                approval_unit: { level: 'default' },
                'help.plate': { level: 'default' },
                'sla.review': { level: 'unit', unitId: 'damot' }
            }
        });
    });

    it('refuses a key that is no configuration key, and a value that does not fit its family', () => {
        expect(configValuesSchema.safeParse({ 'sla.review': { businessHours: 8 } }).success).toBe(true);
        expect(configValuesSchema.safeParse({ colour: 'red' }).success).toBe(false);
        expect(configValuesSchema.safeParse({ 'sla.review.extra': { businessHours: 8 } }).success).toBe(false);
        expect(configValuesSchema.safeParse({ approval_unit: '${approval_unit}' }).success).toBe(false);
        expect(overridePolicySchema.safeParse({ colour: ['unit'] }).success).toBe(false);
    });
});

describe('a service with a fee gives it only while the fee stands paid (ADR-0042)', () => {
    const PAID = { fact: 'payment.settled', op: 'eq', value: true } as const;
    const gives = (e: string) => e === 'competency.activateLicence' || e === 'documents.issue';
    const keyOf = (reference: string) => reference.split(':')[0] ?? reference;
    const workflow = (transitions: object[]) =>
        ({ key: 'w', states: [], transitions }) as unknown as Parameters<typeof unpaidGiving>[0];

    it('reads a guard as requiring the payment only when every branch does', () => {
        expect(requiresSettled(PAID)).toBe(true);
        expect(requiresSettled({ all: [{ fact: 'exam.passed', op: 'eq', value: true }, PAID] })).toBe(true);
        expect(requiresSettled({ any: [PAID, { fact: 'exam.passed', op: 'eq', value: true }] })).toBe(false);
        expect(requiresSettled({ any: [PAID, { all: [PAID] }] })).toBe(true);
        expect(requiresSettled({ not: { fact: 'payment.settled', op: 'eq', value: false } })).toBe(false);
        expect(requiresSettled({ fact: 'payment.settled', op: 'ne', value: false })).toBe(false);
        expect(requiresSettled(undefined)).toBe(false);
    });

    it('names the transitions that give the service without that guard', () => {
        const found = unpaidGiving(
            workflow([
                { from: 'a', to: 'b', action: 'approve', effects: ['competency.createPendingLicence'] },
                { from: 'b', to: 'c', on: 'event:x', guard: PAID, effects: ['competency.activateLicence'] },
                { from: 'b', to: 'd', action: 'print', effects: ['documents.issue:licence-card'] }
            ]),
            gives,
            keyOf
        );
        expect(found).toEqual([{ index: 2, effects: ['documents.issue'] }]);
    });
});
