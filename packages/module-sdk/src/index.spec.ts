import { describe, expect, it } from 'vitest';

import { defineModule, manifestProblems, permissionsOf, type ModuleManifestInput } from './index';

const valid: ModuleManifestInput = {
    key: 'competency',
    layer: 'work-process',
    version: '1.0.0',
    title: { am: 'የአሽከርካሪና ተሽከርካሪ ብቃት ማረጋገጫ', en: 'Driver and vehicle competency' },
    workProcess: 1,
    dependsOn: ['kernel', 'drivers'],
    permissions: { licence: ['read', 'issue'] },
    roles: { 'competency.officer': ['licence:read', 'licence:issue', 'person:read'] },
    effects: ['competency.issueLicence'],
    events: { emits: ['licence.issued.v1'] }
};

describe('defineModule', () => {
    it('returns a valid manifest with the defaults filled in', () => {
        const m = defineModule(valid);
        expect(m.key).toBe('competency');
        expect(m.events).toEqual({ emits: ['licence.issued.v1'], consumes: [] });
        expect(m.services).toEqual([]);
        expect(permissionsOf(m)).toEqual(['licence:read', 'licence:issue']);
    });

    it('rejects a key that is not kebab-case', () => {
        expect(() => defineModule({ ...valid, key: 'Competency_1' })).toThrow(/kebab-case/);
    });

    it('rejects a module that depends on itself', () => {
        expect(() => defineModule({ ...valid, dependsOn: ['competency'] })).toThrow(/itself/);
    });

    it('rejects a kernel with dependencies', () => {
        expect(() => defineModule({ key: 'kernel', layer: 'kernel', version: '0.0.0', dependsOn: ['forms'] })).toThrow(
            /kernel depends on nothing/
        );
    });

    it('rejects keys the module does not own, bad event names and unknown fields', () => {
        const problems = manifestProblems({
            ...valid,
            roles: { 'drivers.clerk': ['licence:read'] },
            effects: ['competency.issueLicence', 'payments.refund']
        });
        expect(problems).toEqual([
            'role "drivers.clerk" must start with "competency."',
            'effect "payments.refund" must start with "competency."'
        ]);
        expect(manifestProblems({ ...valid, events: { emits: ['licenceIssued'] } })[0]).toMatch(
            /events.emits.0: must be <entity>.<happened>.v<n>/
        );
        expect(manifestProblems({ ...valid, menus: [] })[0]).toMatch(/menus/);
    });

    it('asks a work-process module for its work process and title', () => {
        const rest = { ...valid, workProcess: undefined, title: undefined };
        expect(manifestProblems(rest)).toEqual([
            'a work-process module names its workProcess',
            'a work-process module has a title'
        ]);
    });

    it('lists every shape problem at once', () => {
        const problems = manifestProblems({ key: 'X', layer: 'platform', version: 'v1', dependsOn: ['a', 'a'] });
        expect(problems.map((p) => p.split(':')[0])).toEqual(['key', 'version']);
        expect(manifestProblems({ key: 'x', layer: 'platform', version: '1.0.0', dependsOn: ['a', 'a'] })).toEqual([
            'dependsOn has duplicates'
        ]);
    });
});

describe('the documented key formats', () => {
    it('take underscores in names and snake_case capabilities', () => {
        expect(
            manifestProblems({
                ...valid,
                key: 'hr',
                workProcess: 9,
                permissions: { payroll: ['prepare', 'approve'] },
                roles: { 'hr.payroll_officer': ['payroll:prepare'], 'hr.payroll_approver': ['payroll:approve'] },
                effects: [],
                capabilitiesRequired: { 'HR-01': ['prints_documents', 'has_examiners'] }
            })
        ).toEqual([]);
        expect(manifestProblems({ ...valid, capabilitiesRequired: { 'DVC-01': ['prints-documents'] } })[0]).toMatch(
            /snake_case capability/
        );
    });

    it('let the kernel own the cross-cutting roles and the installation-wide settings, and nobody else', () => {
        expect(
            manifestProblems({
                key: 'kernel',
                layer: 'kernel',
                version: '0.0.0',
                permissions: { service: ['configure'] },
                roles: { bureau_admin: ['service:configure'], cashier: [] },
                settings: [
                    { key: 'i18n.languages', default: ['am', 'en'] },
                    { key: 'security.session_idle_minutes', default: 30 }
                ]
            })
        ).toEqual([]);
        expect(manifestProblems({ ...valid, roles: { cashier: [] } })).toEqual([
            'role "cashier" must start with "competency."'
        ]);
    });
});
