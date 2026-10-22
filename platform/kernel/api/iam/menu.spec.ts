import { defineModule } from '@itrms/module-sdk';
import { describe, expect, it } from 'vitest';

import kernel from '../../module';
import { CLIENT_SETTINGS, effectiveMenu, roleLabelKey, roleLabels, type MenuContext } from './menu';

const competency = defineModule({
    key: 'competency',
    layer: 'work-process',
    version: '1.0.0',
    title: { am: 'ብቃት', en: 'Competency' },
    workProcess: 1,
    permissions: { licence: ['read', 'print'] },
    menu: [
        {
            key: 'competency.print',
            group: 'work-process',
            order: 30,
            label: 'competency.nav.print',
            icon: 'printer',
            route: '/competency/print',
            requires: { permission: 'licence:print', services: ['DVC-03'], capabilities: ['prints_documents'] }
        },
        {
            key: 'competency.applications',
            group: 'work-process',
            order: 10,
            label: 'competency.nav.applications',
            icon: 'id-card',
            route: '/competency/applications',
            requires: { permission: 'licence:read', services: ['DVC-03', 'DVC-04'] },
            quickActions: [
                {
                    key: 'competency.new',
                    label: 'competency.action.new',
                    route: '/competency/applications/new',
                    requires: { permission: 'licence:print' }
                }
            ]
        }
    ]
});

const messages = {
    am: { 'kernel.nav.home': 'መነሻ', 'kernel.nav.group.home': 'መነሻ', 'competency.nav.applications': 'ማመልከቻዎች' },
    en: { 'kernel.nav.home': 'Home', 'kernel.nav.group.home': 'Home', 'competency.nav.applications': 'Applications' }
};

const menuOf = (context: Partial<MenuContext>) =>
    effectiveMenu([competency, kernel], messages, {
        permissions: new Set(),
        services: new Set(),
        capabilities: new Set(),
        ...context
    });
const keys = (context: Partial<MenuContext>) => menuOf(context).flatMap((g) => g.items.map((i) => i.key));

describe('the effective menu (ADR-0028)', () => {
    it('shows an item only with its permission, one of its services offered here, and all its capabilities', () => {
        // a woreda office: no licensing services, whatever the role
        expect(keys({ permissions: new Set(['licence:read', 'licence:print']) })).toEqual(['kernel.home']);
        // a town that offers DVC-04 but cannot print, to an officer
        const officer = { permissions: new Set(['licence:read']), services: new Set(['DVC-04']) };
        expect(keys(officer)).toEqual(['kernel.home', 'competency.applications']);
        // printing needs the permission and the capability
        const printer = { permissions: new Set(['licence:read', 'licence:print']), services: new Set(['DVC-03']) };
        expect(keys(printer)).toEqual(['kernel.home', 'competency.applications']);
        expect(keys({ ...printer, capabilities: new Set(['prints_documents']) })).toEqual([
            'kernel.home',
            'competency.applications',
            'competency.print'
        ]);
    });

    it('orders the groups (home, then work processes) and the items, names the work process by its module', () => {
        const menu = menuOf({
            permissions: new Set(['licence:read']),
            services: new Set(['DVC-03'])
        });
        expect(menu.map((g) => g.key)).toEqual(['home', 'work-process:1']);
        expect(menu[0]?.label).toEqual({ am: 'መነሻ', en: 'Home' });
        expect(menu[1]?.label).toEqual({ am: 'ብቃት', en: 'Competency' });
        expect(menu[1]?.items[0]).toMatchObject({
            label: { am: 'ማመልከቻዎች', en: 'Applications' },
            icon: 'id-card',
            route: '/competency/applications',
            // the quick action needs a permission this person lacks
            quickActions: []
        });
    });

    it("orders a group that several modules feed by the items' order, not by the modules'", () => {
        const reports = (key: string, order: number) =>
            defineModule({
                key,
                layer: 'platform',
                version: '1.0.0',
                menu: [
                    {
                        key: `${key}.list`,
                        group: 'reports',
                        order,
                        label: `${key}.nav.list`,
                        icon: 'chart-bar',
                        route: `/${key}`
                    }
                ]
            });
        const menu = effectiveMenu([reports('fees', 20), reports('reports', 10)], messages, {
            permissions: new Set(),
            services: new Set(),
            capabilities: new Set()
        });
        expect(menu[0]?.items.map((i) => i.key)).toEqual(['reports.list', 'fees.list']);
    });
});

describe('role names and client settings', () => {
    it("names roles from their owners' catalogues", () => {
        expect(roleLabelKey('cashier')).toBe('kernel.role.cashier');
        expect(roleLabelKey('competency.officer')).toBe('competency.role.officer');
        const names = { am: { 'kernel.role.cashier': 'ገንዘብ ያዥ' }, en: { 'kernel.role.cashier': 'Cashier' } };
        expect(roleLabels(names, ['cashier', 'cashier'])).toEqual({ cashier: { am: 'ገንዘብ ያዥ', en: 'Cashier' } });
    });

    it('lets only display settings reach the browser', () => {
        expect(
            ['ui.density', 'i18n.languages', 'security.sessionIdle', 'service.fees'].filter((k) =>
                CLIENT_SETTINGS.test(k)
            )
        ).toEqual(['ui.density', 'i18n.languages']);
    });
});
