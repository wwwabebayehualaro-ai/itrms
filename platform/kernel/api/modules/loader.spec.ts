import { defineModule, type InstalledSlice, type ModuleManifestInput } from '@itrms/module-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadSlices, ManifestError } from './loader';

const title = { am: 'ርዕስ', en: 'Title' };
const slice = (
    input: ModuleManifestInput,
    extra: Omit<InstalledSlice<string>, 'manifest'> = {}
): InstalledSlice<string> => ({
    manifest: defineModule(input),
    module: `${input.key}-module`,
    ...extra
});

const kernel = slice({ key: 'kernel', layer: 'kernel', version: '1.0.0', permissions: { user: ['read', 'manage'] } });
const workflow = slice({ key: 'workflow', layer: 'platform', version: '1.0.0', dependsOn: ['kernel'] });
const drivers = slice(
    {
        key: 'drivers',
        layer: 'registry',
        version: '1.0.0',
        title,
        dependsOn: ['kernel'],
        permissions: { person: ['read'] },
        events: { emits: ['licence.issued.v1'] }
    },
    { events: { 'licence.issued.v1': z.object({ licenceId: z.string() }) } }
);
const competency = slice(
    {
        key: 'competency',
        layer: 'work-process',
        version: '1.0.0',
        title,
        workProcess: 1,
        dependsOn: ['kernel', 'drivers', 'workflow'],
        permissions: { licence: ['read', 'issue'] },
        roles: { 'competency.officer': ['licence:read', 'licence:issue', 'person:read'] },
        effects: ['competency.issueLicence'],
        events: { consumes: ['licence.issued.v1'] }
    },
    { effects: ['competency.issueLicence'] }
);

/** A second work process, varied per test. */
const freight = (
    extra: Partial<ModuleManifestInput> = {},
    events?: InstalledSlice<string>['events']
): InstalledSlice<string> =>
    slice(
        {
            key: 'freight',
            layer: 'work-process',
            version: '1.0.0',
            title,
            workProcess: 3,
            dependsOn: ['kernel'],
            ...extra
        },
        events ? { events } : {}
    );

/** The problems loadSlices reports, or [] when it loads. */
function problems(slices: InstalledSlice<string>[], disabled?: string[]): string[] {
    try {
        loadSlices(slices, { disabled });
        return [];
    } catch (e) {
        expect(e).toBeInstanceOf(ManifestError);
        return (e as ManifestError).problems;
    }
}

describe('loadSlices', () => {
    it('loads a sound installation and returns the enabled modules', () => {
        const loaded = loadSlices([kernel, workflow, drivers, competency]);
        expect(loaded.manifests.map((m) => m.key)).toEqual(['kernel', 'workflow', 'drivers', 'competency']);
        expect(loaded.modules).toEqual(['kernel-module', 'workflow-module', 'drivers-module', 'competency-module']);
        expect(loadSlices([kernel, workflow, drivers, competency], { disabled: ['competency'] }).modules).not.toContain(
            'competency-module'
        );
    });

    it('stops on a dependency that is missing or disabled, on an unknown switch, and on switching the core off', () => {
        expect(problems([kernel, drivers, competency])).toEqual([
            'competency: depends on "workflow", which is not installed'
        ]);
        expect(problems([kernel, workflow, drivers, competency], ['workflow'])).toEqual([
            'workflow: is part of the core (platform) and cannot be disabled',
            'competency: depends on "workflow", which is disabled'
        ]);
        expect(problems([kernel, workflow, drivers, competency], ['kernel', 'drivers', 'payments'])).toEqual([
            'kernel: is part of the core (kernel) and cannot be disabled',
            'drivers: is part of the core (registry) and cannot be disabled',
            'payments: is disabled but not installed',
            'workflow: depends on "kernel", which is disabled',
            'competency: depends on "kernel", which is disabled',
            'competency: depends on "drivers", which is disabled'
        ]);
        expect(problems([workflow])).toEqual([
            'kernel: is not installed',
            'workflow: depends on "kernel", which is not installed'
        ]);
        expect(problems([kernel, kernel])).toEqual(['kernel: is installed twice']);
    });

    it('stops on a dependency up the layers, between work processes, or in a cycle', () => {
        const upward = slice({ key: 'forms', layer: 'platform', version: '1.0.0', dependsOn: ['kernel', 'drivers'] });
        expect(problems([kernel, drivers, upward])).toEqual([
            'forms: depends on "drivers" (registry), a layer above its own (platform)'
        ]);
        expect(
            problems([kernel, workflow, drivers, competency, freight({ dependsOn: ['kernel', 'competency'] })])
        ).toEqual(['freight: depends on "competency": work-process modules never depend on each other']);
        const a = slice({ key: 'a', layer: 'platform', version: '1.0.0', dependsOn: ['kernel', 'b'] });
        const b = slice({ key: 'b', layer: 'platform', version: '1.0.0', dependsOn: ['kernel', 'a'] });
        expect(problems([kernel, a, b])).toEqual(['dependency cycle: a → b → a']);
    });

    it('stops on a permission resource two installed modules define, and on a role granting what nobody defines', () => {
        const rival = freight({ permissions: { licence: ['read'] }, roles: { 'freight.clerk': ['payroll:approve'] } });
        const expected = [
            'freight: permission resource "licence" is already defined by "competency"',
            'freight: role "freight.clerk" grants "payroll:approve", which no installed module defines'
        ];
        expect(problems([kernel, workflow, drivers, competency, rival])).toEqual(expected);
        // a clash is a clash even while one of the two is switched off
        expect(problems([kernel, workflow, drivers, competency, rival], ['freight'])).toEqual(expected.slice(0, 1));
    });

    it('stops on effects declared but not implemented, or implemented but not declared', () => {
        expect(problems([kernel, workflow, drivers, { ...competency, effects: ['competency.renewLicence'] }])).toEqual([
            'competency: effect "competency.issueLicence" is declared but not implemented',
            'competency: implements effect "competency.renewLicence" without declaring it'
        ]);
    });

    it('stops on an event without a schema, emitted twice, or consumed but emitted by no installed module', () => {
        expect(problems([kernel, workflow, { ...drivers, events: {} }, competency])).toEqual([
            'drivers: emits "licence.issued.v1" without a payload schema'
        ]);
        const twice = freight({ events: { emits: ['licence.issued.v1'] } }, { 'licence.issued.v1': z.object({}) });
        expect(problems([kernel, workflow, drivers, competency, twice])).toEqual([
            'freight: emits "licence.issued.v1", which "drivers" already emits'
        ]);
        expect(
            problems([kernel, workflow, drivers, competency, freight({ events: { consumes: ['route.closed.v1'] } })])
        ).toEqual(['freight: consumes "route.closed.v1", which no installed module emits']);
    });

    it('lets a product be switched off without stopping the others that talk to it', () => {
        // freight consumes competency's event and grants competency's permission; competency is off in this installation
        const emitting = slice(
            {
                ...competency.manifest,
                events: { emits: ['exam.passed.v1'], consumes: [] }
            },
            { effects: ['competency.issueLicence'], events: { 'exam.passed.v1': z.object({}) } }
        );
        const listening = freight({
            events: { consumes: ['exam.passed.v1'] },
            roles: { 'freight.officer': ['licence:read'] }
        });
        expect(problems([kernel, workflow, drivers, emitting, listening], ['competency'])).toEqual([]);
    });

    it('says every problem in one message', () => {
        expect(() => loadSlices([kernel, competency])).toThrow(
            /The installed modules cannot start:\n- competency: depends on "drivers", which is not installed\n- competency: depends on "workflow"/
        );
    });
});
