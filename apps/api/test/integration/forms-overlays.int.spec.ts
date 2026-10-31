/**
 * Form overlays and form tiers (task 0.21f, form-platform.md §4), on a real PostgreSQL 16: a zone's administrator adds a
 * field to a bureau form (and may not touch a field a service's effect locks); a second person approves it; a woreda adds
 * its own; the woreda's new cases are filed on the bureau's form with both overlays composed in, a sibling woreda's on the
 * bureau's alone; a new bureau version re-applies the overlays and reports what no longer fits, and an open case keeps
 * the form it was filed on. Overlays apply only where the service's policy lets them, and only to bureau forms.
 */
import { Injectable, Module } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

/** Reads the plate and the owner: both fields are locked on the form. */
@Injectable()
@Effect('test.overlayPermit', { input: { plate: { kind: 'text' }, holder: { kind: 'text' } } })
class OverlayPermit implements WorkflowEffect<Record<string, unknown>> {
    run({ input }: EffectRun<Record<string, unknown>>) {
        return Promise.resolve({ facts: { permit: input } });
    }
}

@Module({ providers: [OverlayPermit] })
class TestEffects {}

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000c401',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    zoneAdmin: '0199f0a0-d000-7000-8000-000000000102',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    damotAdmin: '0199f0a0-d000-7000-8000-00000000c402',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302'
};
const SERVICE = 'RS-03';

let pg: TestPostgres;
let api: TestApi;
const as = {} as Record<keyof typeof SUB, As>;
const ids = { form: '', base: '', workflowVersion: '', damot: '', zone: '' };

const field = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    classification: 'personal',
    label: { am: id, en: id },
    props: {},
    behavior: { validation: { supported: true } },
    ...extra
});
const CATEGORY = field('category', {
    type: 'Dropdown',
    data: {
        dataSource: {
            staticData: [
                { label: { am: 'ሀ', en: 'A' }, value: 'a' },
                { label: { am: 'ለ', en: 'B' }, value: 'b' }
            ]
        }
    }
});
const FORM = {
    schemaVersion: 2,
    fields: [
        field('plate', { props: { required: true } }),
        field('owner', { props: { required: true } }),
        field('remark'),
        CATEGORY
    ]
};
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

/** Approves a publication as a second person, and fails the test if it is refused. */
async function approve(who: As, publication: { id: string; version: number }) {
    const res = await api.call(
        'POST',
        `/api/v1/form-publications/${publication.id}/approval`,
        who,
        {},
        ifMatch(publication.version)
    );
    expect(res.statusCode, res.body).toBeLessThan(300);
}

/** Writes a unit's overlay and asks for its publication; the publication. */
async function overlay(who: As, unitId: string, patch: object) {
    const current = await api.call('GET', `/api/v1/forms/${ids.form}/overlays/${unitId}`, who);
    expect(current.statusCode, current.body).toBe(200);
    const { version } = current.json<{ version: number | null }>();
    const saved = await api.call(
        'PUT',
        `/api/v1/forms/${ids.form}/overlays/${unitId}`,
        who,
        { patch },
        version === null ? {} : ifMatch(version)
    );
    expect(saved.statusCode, saved.body).toBe(200);
    return api.call('POST', `/api/v1/forms/${ids.form}/overlays/${unitId}/publications`, who, {});
}

/** A request for the service at the person's office, filed with these answers; the case. */
async function file(who: As, answers: Record<string, unknown>) {
    const res = await api.call('POST', '/api/v1/service-requests', who, { serviceCode: SERVICE, answers });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<CaseOut>();
}

/** The form version a case's request was filed on, and that version's base and overlays. */
async function filedOn(caseId: string) {
    const { rows } = await api.owner.query<{
        form_version_id: string;
        base: string | null;
        overlays: string[] | null;
        owner: string;
    }>(
        `select s.form_version_id, v.base_version_id as base, v.overlay_version_ids as overlays, v.owner_unit_id as owner
           from forms.submissions s join forms.form_versions v on v.id = s.form_version_id
          where s.case_id = $1`,
        [caseId]
    );
    return rows[0];
}

const keysOf = (document: unknown) => ((document as { fields: { id: string }[] }).fields ?? []).map((f) => f.id);

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(
        pg,
        [
            {
                username: 'test.bureau.overlays',
                sub: SUB.bureau2,
                region: 'SER',
                home: 'SER',
                roles: [['SER', 'bureau_admin']]
            },
            {
                username: 'test.damot.admin',
                sub: SUB.damotAdmin,
                region: 'SER',
                home: 'WOL-DAMOT-GALE',
                roles: [['WOL-DAMOT-GALE', 'unit_admin']]
            }
        ],
        { modules: [TestEffects] }
    );
    const region = await api.unit('SER', 'SER');
    const zone = await api.unit('SER', 'WOL');
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    ids.zone = zone.id;
    ids.damot = damot.id;
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.zoneHead = { sub: SUB.zoneHead, unit: zone };
    as.zoneAdmin = { sub: SUB.zoneAdmin, unit: zone };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.damotRecords = { sub: SUB.damotRecords, unit: damot };
    as.damotAdmin = { sub: SUB.damotAdmin, unit: damot };
    as.boditiRecords = { sub: SUB.boditiRecords, unit: await api.unit('SER', 'WOL-BODITI') };

    const created = await api.call('POST', '/api/v1/forms', as.bureau, {
        key: 'overlay-permit',
        name: { am: 'ፈቃድ', en: 'Permit' },
        document: FORM
    });
    expect(created.statusCode, created.body).toBe(201);
    ids.form = created.json<{ id: string }>().id;
    const asked = await api.call('POST', `/api/v1/forms/${ids.form}/publications`, as.bureau, {});
    expect(asked.statusCode, asked.body).toBe(201);
    const publication = asked.json<{ id: string; version: number; formVersion: { id: string } }>();
    await approve(as.bureau2, publication);
    ids.base = publication.formVersion.id;

    const workflow = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key: 'overlay-permit',
        name: { am: 'ፈቃድ', en: 'Permit' },
        definition: {
            schemaVersion: 1,
            states: [
                { key: 'draft', kind: 'start', label: { am: 'ረቂቅ', en: 'Draft' } },
                {
                    key: 'review',
                    kind: 'task',
                    label: { am: 'ማጣራት', en: 'Review' },
                    assignee: { role: 'records_officer', unit: 'handling' }
                },
                { key: 'done', kind: 'end', label: { am: 'ተጠናቋል', en: 'Done' } }
            ],
            transitions: [
                { from: 'draft', to: 'review', action: 'submit' },
                {
                    from: 'review',
                    to: 'done',
                    action: 'issue',
                    label: { am: 'ስጥ', en: 'Issue' },
                    effects: ['test.overlayPermit']
                }
            ]
        }
    });
    expect(workflow.statusCode, workflow.body).toBe(201);
    ids.workflowVersion = workflow.json<{ latestVersion: { id: string } }>().latestVersion.id;
    const published = await api.call('POST', `/api/v1/services/${SERVICE}/versions`, as.bureau, {
        workflowVersionId: ids.workflowVersion,
        formVersionId: ids.base,
        inputMap: { 'test.overlayPermit': { holder: 'owner' } },
        overridePolicy: { formOverlay: ['region', 'unit'] }
    });
    expect(published.statusCode, published.body).toBe(201);
}, 300_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('a form overlay', () => {
    it('lets a zone add a field, never touch a locked one, and takes effect when a second person approves it', async () => {
        // a locked field (an effect reads the plate) is untouchable: refused when its publication is asked for
        const locked = await overlay(as.zoneAdmin, ids.zone, {
            add: [{ after: 'remark', fields: [field('x_zone_q')] }],
            options: [{ key: 'plate', values: ['a'] }]
        });
        expect(locked.statusCode).toBe(422);
        expect(locked.json()).toMatchObject({ errors: [{ code: 'overlay_locked' }] });

        // a field with actions could set a bureau answer at the counter: refused
        const acting = await overlay(as.zoneAdmin, ids.zone, {
            add: [
                {
                    after: 'remark',
                    fields: [
                        field('x_zone_q', {
                            behavior: {
                                actions: { onChange: [{ type: 'setValue', payload: { field: 'owner', value: 'x' } }] }
                            }
                        })
                    ]
                }
            ]
        });
        expect(acting.statusCode).toBe(422);
        expect(acting.json()).toMatchObject({ errors: [{ code: 'overlay_not_allowed_property' }] });

        // an unreserved key, an anchor inside nothing: refused too
        const unreserved = await overlay(as.zoneAdmin, ids.zone, {
            add: [{ after: 'remark', fields: [field('zoneQ')] }]
        });
        expect(unreserved.statusCode).toBe(422);
        expect(unreserved.json()).toMatchObject({ errors: [{ code: 'overlay_key_reserved' }] });

        const asked = await overlay(as.zoneAdmin, ids.zone, {
            add: [{ after: 'remark', fields: [field('x_zone_q')] }],
            options: [{ key: 'category', values: ['a'] }]
        });
        expect(asked.statusCode, asked.body).toBe(201);
        const publication = asked.json<{ id: string; version: number; overlay: { unit: { id: string } } }>();
        expect(publication.overlay.unit.id).toBe(ids.zone);
        // the approver reviews the form the zone's cases would fill in: its own fields are no reserved keys
        const review = await api.call('GET', `/api/v1/form-publications/${publication.id}/review`, as.zoneHead);
        expect(review.statusCode, review.body).toBe(200);
        expect(review.json()).toMatchObject({ canPublish: true, problems: [] });
        expect(review.json<{ diff: { added: { key: string }[] } }>().diff.added.map((f) => f.key)).toEqual([
            'x_zone_q'
        ]);
        // maker-checker: who asked never decides
        const own = await api.call(
            'POST',
            `/api/v1/form-publications/${publication.id}/approval`,
            as.zoneAdmin,
            {},
            ifMatch(publication.version)
        );
        expect(own.statusCode).toBe(403);
        await approve(as.zoneHead, publication);
        const read = await api.call('GET', `/api/v1/forms/${ids.form}/overlays/${ids.zone}`, as.zoneHead);
        expect(read.json()).toMatchObject({ status: 'published', publishedVersion: { number: 1 }, conflicts: [] });
    });

    it("applies a woreda's field to its own new cases only, with the zone's, and keeps the bureau's form as it is", async () => {
        const asked = await overlay(as.damotAdmin, ids.damot, {
            add: [{ after: 'x_zone_q', fields: [field('x_damot_q')] }]
        });
        expect(asked.statusCode, asked.body).toBe(201);
        await approve(as.damotHead, asked.json<{ id: string; version: number }>());

        // the counter fills in the composed form
        const form = (await api.call('GET', `/api/v1/services/${SERVICE}/request`, as.damotRecords)).json<{
            document: unknown;
        }>();
        expect(keysOf(form.document)).toEqual(['plate', 'owner', 'remark', 'x_zone_q', 'x_damot_q', 'category']);

        const damot = await file(as.damotRecords, {
            plate: 'ETH ABC 0500',
            owner: 'Generated Owner',
            x_damot_q: 'yes',
            x_zone_q: 'zone'
        });
        const damotForm = await filedOn(damot.id);
        expect(damotForm).toMatchObject({ base: ids.base, owner: ids.damot });
        expect(damotForm?.overlays).toHaveLength(2);
        // a second request reuses the composed version
        const again = await file(as.damotRecords, { plate: 'ETH ABC 0501', owner: 'Generated Owner' });
        expect((await filedOn(again.id))?.form_version_id).toBe(damotForm?.form_version_id);

        // Boditi, a sibling woreda: the zone's field, never Damot Gale's; and it cannot read Damot Gale's composed form
        const boditi = await file(as.boditiRecords, {
            plate: 'ETH ABC 0600',
            owner: 'Generated Owner',
            x_damot_q: 'no'
        });
        const boditiForm = await filedOn(boditi.id);
        expect(boditiForm?.overlays).toHaveLength(1);
        const { rows } = await api.owner.query<{ answers: Record<string, unknown> }>(
            'select answers from forms.submissions where case_id = $1',
            [boditi.id]
        );
        expect(rows[0]?.answers).not.toHaveProperty('x_damot_q');
        const hidden = await api.call(
            'GET',
            `/api/v1/forms/${ids.form}/versions/${damotForm?.form_version_id ?? ''}`,
            as.boditiRecords
        );
        expect(hidden.statusCode).toBe(404);

        // the bureau's form keeps its versions: no composed one is listed
        const versions = (await api.call('GET', `/api/v1/forms/${ids.form}/versions`, as.bureau)).json<{
            items: { number: number }[];
        }>().items;
        expect(versions.map((v) => v.number)).toEqual([1]);
    });

    it('is re-applied on a new bureau version, which reports what no longer fits; an open case keeps its form', async () => {
        const open = await file(as.damotRecords, {
            plate: 'ETH ABC 0700',
            owner: 'Generated Owner',
            x_damot_q: 'before'
        });
        const openForm = await filedOn(open.id);

        // the bureau drops the remark the zone's field is added after (flagged removed) and offers only "b"
        const current = (await api.call('GET', `/api/v1/forms/${ids.form}`, as.bureau)).json<{ version: number }>();
        const v2 = {
            schemaVersion: 2,
            fields: [
                field('plate', { props: { required: true } }),
                field('owner', { props: { required: true } }),
                field('remark', { removed: true }),
                { ...CATEGORY, data: { dataSource: { staticData: [{ label: { am: 'ለ', en: 'B' }, value: 'b' }] } } }
            ]
        };
        const patched = await api.call(
            'PATCH',
            `/api/v1/forms/${ids.form}`,
            as.bureau,
            { document: v2 },
            ifMatch(current.version)
        );
        expect(patched.statusCode, patched.body).toBe(200);
        const check = await api.call('GET', `/api/v1/forms/${ids.form}/publish-check`, as.bureau);
        expect(check.statusCode, check.body).toBe(200);
        const impact = check.json<{
            impact: { overlays: { unit: { id: string }; conflicts: { op: string; key: string; problem: string }[] }[] };
        }>().impact.overlays;
        expect(impact.find((o) => o.unit.id === ids.zone)?.conflicts).toEqual([
            expect.objectContaining({ op: 'options', key: 'category', problem: 'option_not_allowed' })
        ]);
        const asked = await api.call('POST', `/api/v1/forms/${ids.form}/publications`, as.bureau, {});
        expect(asked.statusCode, asked.body).toBe(201);
        const publication = asked.json<{ id: string; version: number; formVersion: { id: string } }>();
        await approve(as.bureau2, publication);
        const service = await api.call('POST', `/api/v1/services/${SERVICE}/versions`, as.bureau, {
            workflowVersionId: ids.workflowVersion,
            formVersionId: publication.formVersion.id,
            inputMap: { 'test.overlayPermit': { holder: 'owner' } },
            overridePolicy: { formOverlay: ['region', 'unit'] }
        });
        expect(service.statusCode, service.body).toBe(201);

        // the next request: on the new bureau version, the overlays re-applied (the zone's narrowing passed over)
        const next = await file(as.damotRecords, {
            plate: 'ETH ABC 0701',
            owner: 'Generated Owner',
            x_damot_q: 'after'
        });
        const nextForm = await filedOn(next.id);
        expect(nextForm?.base).toBe(publication.formVersion.id);
        expect(nextForm?.form_version_id).not.toBe(openForm?.form_version_id);
        // the open case keeps the form it was filed on
        expect((await filedOn(open.id))?.form_version_id).toBe(openForm?.form_version_id);
    });

    it('applies only where the policy lets it, and only to bureau forms (the tiers)', async () => {
        // a records officer may not write an overlay; a woreda may not change the bureau's form itself
        const officer = await api.call('PUT', `/api/v1/forms/${ids.form}/overlays/${ids.damot}`, as.damotRecords, {
            patch: { add: [], options: [] }
        });
        expect(officer.statusCode).toBe(403);
        const form = (await api.call('GET', `/api/v1/forms/${ids.form}`, as.damotAdmin)).json<{
            version: number;
            document: unknown;
        }>();
        const edit = await api.call(
            'PATCH',
            `/api/v1/forms/${ids.form}`,
            as.damotAdmin,
            { document: form.document },
            ifMatch(form.version)
        );
        expect(edit.statusCode).toBe(403);
        // the bureau overlays nothing: it changes its form
        const bureau = await api.call('PUT', `/api/v1/forms/${ids.form}/overlays/${as.bureau.unit.id}`, as.bureau, {
            patch: { add: [], options: [] }
        });
        expect(bureau.statusCode).toBe(422);
        // a unit's own form takes no overlay
        const local = await api.call('POST', '/api/v1/forms', as.damotAdmin, {
            key: 'damot-local',
            name: { am: 'የወረዳ', en: 'Local' },
            document: { schemaVersion: 2, fields: [field('note')] }
        });
        expect(local.statusCode, local.body).toBe(201);
        const onLocal = await api.call(
            'PUT',
            `/api/v1/forms/${local.json<{ id: string }>().id}/overlays/${ids.damot}`,
            as.damotAdmin,
            {
                patch: { add: [], options: [] }
            }
        );
        expect(onLocal.statusCode).toBe(422);
        expect(onLocal.json()).toMatchObject({ errors: [{ code: 'not_regional' }] });

        // a service version whose policy lets no overlay apply: the bureau's form as it is
        const current = (await api.call('GET', `/api/v1/forms/${ids.form}`, as.bureau)).json<{
            publishedVersion: { id: string };
        }>();
        const closed = await api.call('POST', `/api/v1/services/${SERVICE}/versions`, as.bureau, {
            workflowVersionId: ids.workflowVersion,
            formVersionId: current.publishedVersion.id,
            inputMap: { 'test.overlayPermit': { holder: 'owner' } }
        });
        expect(closed.statusCode, closed.body).toBe(201);
        const plain = await file(as.damotRecords, { plate: 'ETH ABC 0800', owner: 'Generated Owner' });
        expect((await filedOn(plain.id))?.base).toBeNull();
    });
});
