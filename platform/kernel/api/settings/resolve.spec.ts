import { defineModule } from '@itrms/module-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildSettingsRegistry, defaultsOf, registryRules, settingLabelKey } from './registry';
import { resolve, resolveAll, unitChain, without, type ChainInput } from './resolve';
import { installationValues, userValues } from './settings';

const registry = buildSettingsRegistry([
    {
        manifest: defineModule({
            key: 'kernel',
            layer: 'kernel',
            version: '1.0.0',
            settings: [
                {
                    key: 'ui.density',
                    default: 'comfortable',
                    overridableAt: ['region', 'unit', 'unitType'],
                    userPreference: true
                },
                { key: 'ui.theme', default: 'system', overridableAt: ['region'], userPreference: true },
                { key: 'i18n.languages', default: ['am', 'en'], overridableAt: ['installation', 'region'] },
                { key: 'security.idleMinutes', default: 30, overridableAt: ['installation'], sensitive: true }
            ]
        }),
        settings: {
            'ui.density': z.enum(['comfortable', 'compact']),
            'ui.theme': z.enum(['system', 'light', 'dark']),
            'i18n.languages': z.array(z.string()),
            'security.idleMinutes': z.number().int().positive()
        }
    }
]);
const rules = registryRules(registry);
const values = (o: Record<string, unknown>) => new Map(Object.entries(o));

/** Wolaita's shape: the region, the zone, a woreda (a ምድብ-1 woreda type). */
const wolaita = (over: Partial<ChainInput> = {}): ChainInput => ({
    defaults: defaultsOf(registry),
    units: [
        { unitId: 'region', values: values({}) },
        { unitId: 'zone', values: values({}) },
        { unitId: 'damot', values: values({}) }
    ],
    unitType: { unitTypeId: 'woreda-m1', values: values({}) },
    ...over
});

describe('the one resolver', () => {
    it('takes the nearest value along the real ancestors, the unit type, the unit and the person', () => {
        const at = (input: ChainInput) => resolve('ui.density', unitChain(input), rules);
        expect(at(wolaita())).toEqual({ value: 'comfortable', source: { level: 'default' } });
        const region = { unitId: 'region', values: values({ 'ui.density': 'compact' }) };
        const zone = { unitId: 'zone', values: values({ 'ui.density': 'comfortable' }) };
        const damot = { unitId: 'damot', values: values({ 'ui.density': 'compact' }) };
        const plain = { unitId: 'damot', values: values({}) };
        expect(at(wolaita({ units: [region, { unitId: 'zone', values: values({}) }, plain] }))).toEqual({
            value: 'compact',
            source: { level: 'region', unitId: 'region' }
        });
        // a zone's value beats the region's, in its subtree
        expect(at(wolaita({ units: [region, zone, plain] }))?.source).toEqual({ level: 'unit', unitId: 'zone' });
        // the region's value for the unit's type beats every unit above it …
        const typed = { unitTypeId: 'woreda-m1', values: values({ 'ui.density': 'compact' }) };
        expect(at(wolaita({ units: [region, zone, plain], unitType: typed }))?.source).toEqual({
            level: 'unitType',
            unitTypeId: 'woreda-m1'
        });
        // … the unit's own beats its type's, and the person's own beats everything
        expect(at(wolaita({ units: [region, zone, damot], unitType: typed }))?.source).toEqual({
            level: 'unit',
            unitId: 'damot'
        });
        expect(
            at(
                wolaita({
                    units: [region, zone, damot],
                    unitType: typed,
                    user: values({ 'ui.density': 'comfortable' })
                })
            )
        ).toEqual({ value: 'comfortable', source: { level: 'user' } });
    });

    it('follows a region without zones and a city with sub-cities alike (whatever the depth)', () => {
        const flat = unitChain({
            defaults: defaultsOf(registry),
            units: [
                { unitId: 'trx', values: values({ 'ui.density': 'compact' }) },
                { unitId: 'city', values: values({}) },
                { unitId: 'sub-city', values: values({}) },
                { unitId: 'kebele', values: values({}) }
            ]
        });
        expect(resolve('ui.density', flat, rules)?.source).toEqual({ level: 'region', unitId: 'trx' });
        // the root asked about itself: its own value is the region's
        const root = unitChain({ defaults: defaultsOf(registry), units: [{ unitId: 'trx', values: values({}) }] });
        expect(root.map((l) => l.source.level)).toEqual(['default', 'installation', 'region']);
    });

    it('passes over a level the key does not allow, and a stored value its schema no longer accepts', () => {
        const chain = unitChain(
            wolaita({
                installation: values({ 'i18n.languages': ['am', 'en', 'om'], 'ui.theme': 'dark' }),
                units: [
                    { unitId: 'region', values: values({ 'ui.theme': 'light' }) },
                    // set before the code allowed it only at the region (or a value that no longer fits)
                    {
                        unitId: 'zone',
                        values: values({ 'ui.theme': 'dark', 'i18n.languages': ['am', 'en', 'wal-Latn'] })
                    },
                    { unitId: 'damot', values: values({ 'ui.density': 'roomy' }) }
                ]
            })
        );
        expect(resolve('ui.theme', chain, rules)).toEqual({
            value: 'light',
            source: { level: 'region', unitId: 'region' }
        });
        expect(resolve('i18n.languages', chain, rules)).toEqual({
            value: ['am', 'en', 'om'],
            source: { level: 'installation' }
        });
        expect(resolve('ui.density', chain, rules)?.source).toEqual({ level: 'default' });
        // a person's own value of a key that is no personal choice
        const mine = unitChain(wolaita({ user: values({ 'i18n.languages': ['am', 'en', 'om'] }) }));
        expect(resolve('i18n.languages', mine, rules)?.source).toEqual({ level: 'default' });
        // an unknown key has no value at all
        expect(resolve('ui.unknown', mine, rules)).toBeUndefined();
    });

    it('says what a unit inherits: its value without its own layer', () => {
        const chain = unitChain(
            wolaita({
                units: [
                    { unitId: 'region', values: values({ 'ui.density': 'compact' }) },
                    { unitId: 'zone', values: values({}) },
                    { unitId: 'damot', values: values({ 'ui.density': 'comfortable' }) }
                ]
            })
        );
        expect(resolve('ui.density', chain, rules)?.source).toEqual({ level: 'unit', unitId: 'damot' });
        expect(resolve('ui.density', without(chain, { level: 'unit', unitId: 'damot' }), rules)).toEqual({
            value: 'compact',
            source: { level: 'region', unitId: 'region' }
        });
        expect([...resolveAll(registry.keys(), chain, rules).keys()]).toEqual([...registry.keys()]);
    });
});

describe('the registry', () => {
    it("names each setting in its owner's catalogue", () => {
        expect(settingLabelKey('kernel', 'ui.theme')).toBe('kernel.setting.ui.theme');
        expect(settingLabelKey('forms', 'forms.exports.keepDays')).toBe('forms.setting.exports.keepDays');
    });

    it("checks the installation's values: a key, a level and a value it allows, or the start stops", () => {
        expect(installationValues(registry, { 'security.idleMinutes': 15 }).get('security.idleMinutes')).toBe(15);
        expect(() => installationValues(registry, { 'ui.theme': 'dark' })).toThrow(
            /cannot be set for the installation/
        );
        expect(() => installationValues(registry, { 'security.idleMinutes': -1 })).toThrow(/does not fit its schema/);
        expect(() => installationValues(registry, { 'security.unknown': 1 })).toThrow(/is not a setting/);
    });

    it("reads a person's own values among their preferences: personal choices only, a reset (null) left out", () => {
        const mine = userValues(registry, {
            language: 'am',
            favourites: ['kernel.home'],
            'ui.theme': 'dark',
            'ui.density': null,
            'i18n.languages': ['am', 'en', 'om']
        });
        expect([...mine]).toEqual([['ui.theme', 'dark']]);
        expect(userValues(registry, null).size).toBe(0);
    });
});
