/**
 * A filed request changed through its case (task 0.21e), on a real PostgreSQL 16: an action that `amendsRequest` replaces
 * the request's answers, checked again on the version it was filed on; what the actor may not see keeps its answer; the
 * answers it replaced are kept as a revision; the timeline names the fields changed; the request's filterable values are
 * written again; every write is on the audit log. Nobody else changes it, and an invalid change changes nothing. The
 * office's requests are listed across services, waiting or recent, to its subtree only. A request holding files, a
 * Sensitive answer and a repeating section with columns the actor may not see or change keeps all of them as filed.
 */
import { randomUUID } from 'node:crypto';

import type { CaseList, CaseOut } from '@itrms/workflow/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000c301',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    boditiHead: '0199f0a0-d000-7000-8000-000000000301'
};
const SERVICE = 'RS-05';
/** the request with what its corrector may not see or change */
const HIDDEN_SERVICE = 'RS-06';
/** the request with fields other roles' rules show, and a column nobody here sees */
const RULED_SERVICE = 'RS-07';
/** the request with Sensitive answers other roles' rules show, a derived total and a field the corrector cannot hide */
const KEPT_SERVICE = 'RS-01';

let pg: TestPostgres;
let api: TestApi;
const as = {} as Record<keyof typeof SUB, As>;

const text = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    classification: 'personal',
    label: id,
    props: extra.required ? { required: true } : {},
    behavior: { validation: { supported: true } },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'required'))
});
const FORM = {
    schemaVersion: 2,
    fields: [
        text('plate', { required: true, filterable: true }),
        text('owner', { required: true }),
        // the intake's own note: the head who corrects the request never sees it
        text('intakeNote', { visibleToRoles: ['records_officer'] })
    ]
};
const HIDDEN_FORM = {
    schemaVersion: 2,
    fields: [
        text('plate', { required: true }),
        text('phone', { classification: 'sensitive' }),
        text('scan', { type: 'FileUpload' }),
        text('people', { type: 'FormArray', props: {}, layout: { options: { isContainer: true } } }),
        text('name', { parentId: 'people' }),
        text('idNo', { parentId: 'people', classification: 'sensitive' }),
        text('checkedBy', { parentId: 'people', visibleToRoles: ['records_officer'] })
    ]
};
// a remark the records officer's rules show (no role restriction), and a column only an auditor sees, required
const RULED_FORM = {
    schemaVersion: 2,
    fields: [
        text('plate', { required: true }),
        text('intakeRemark', {
            behavior: {
                validation: { supported: true },
                visibilityConditions: [{ field: 'user.roles', operator: 'contains', value: 'records_officer' }]
            }
        }),
        text('vehicles', { type: 'FormArray', props: {}, layout: { options: { isContainer: true } } }),
        text('vplate', { parentId: 'vehicles' }),
        text('inspector', { parentId: 'vehicles', required: true, visibleToRoles: ['auditor'] })
    ]
};
const recordsOnly = [{ field: 'user.roles', operator: 'contains', value: 'records_officer' }];
const KEPT_FORM = {
    schemaVersion: 2,
    fields: [
        text('plate', { required: true }),
        // Sensitive, and shown only to the records officer by its rule
        text('secretNote', {
            classification: 'sensitive',
            behavior: { validation: { supported: true }, visibilityConditions: recordsOnly }
        }),
        // a Sensitive section: its rows hold what nobody here may change
        text('family', {
            type: 'FormArray',
            classification: 'sensitive',
            props: {},
            layout: { options: { isContainer: true } }
        }),
        text('relation', { parentId: 'family' }),
        // a total derived from a quantity, seen by the records officer alone
        text('qty', { type: 'InputNumber' }),
        text('total', {
            type: 'InputNumber',
            visibleToRoles: ['records_officer'],
            data: { defaultProps: {}, computed: { expression: '{{= form.qty * 2 }}', readOnly: true } }
        }),
        // the records officer's answer, shown only while the vehicle is insured
        text('insured'),
        text('insuranceNo', {
            visibleToRoles: ['records_officer'],
            behavior: {
                validation: { supported: true },
                visibilityConditions: [{ field: 'insured', operator: 'eq', value: 'yes' }]
            }
        })
    ]
};
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

/** A form published by the bureau (asked by one administrator, approved by another); its version's id. */
async function publishedForm(key: string, document: object): Promise<string> {
    const created = await api.call('POST', '/api/v1/forms', as.bureau, { key, name: { am: key, en: key }, document });
    expect(created.statusCode, created.body).toBe(201);
    const asked = await api.call(
        'POST',
        `/api/v1/forms/${created.json<{ id: string }>().id}/publications`,
        as.bureau,
        {}
    );
    expect(asked.statusCode, asked.body).toBe(201);
    const publication = asked.json<{ id: string; version: number; formVersion: { id: string } }>();
    const approved = await api.call(
        'POST',
        `/api/v1/form-publications/${publication.id}/approval`,
        as.bureau2,
        {},
        ifMatch(publication.version)
    );
    expect(approved.statusCode, approved.body).toBeLessThan(300);
    return publication.formVersion.id;
}

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.bureau.fourth',
            sub: SUB.bureau2,
            region: 'SER',
            home: 'SER',
            roles: [['SER', 'bureau_admin']]
        }
    ]);
    const region = await api.unit('SER', 'SER');
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.damotRecords = { sub: SUB.damotRecords, unit: damot };
    as.zoneHead = { sub: SUB.zoneHead, unit: await api.unit('SER', 'WOL') };
    as.boditiHead = { sub: SUB.boditiHead, unit: await api.unit('SER', 'WOL-BODITI') };

    const formVersionId = await publishedForm('plate-request', FORM);

    const workflow = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key: 'plate-check',
        name: { am: 'ሰሌዳ ማጣራት', en: 'Plate check' },
        definition: {
            schemaVersion: 1,
            states: [
                { key: 'draft', kind: 'start', label: { am: 'ረቂቅ', en: 'Draft' } },
                {
                    key: 'check',
                    kind: 'task',
                    label: { am: 'ማጣራት', en: 'Check' },
                    assignee: { role: 'unit_head', unit: 'handling' }
                },
                { key: 'done', kind: 'end', label: { am: 'ተጠናቋል', en: 'Done' } }
            ],
            transitions: [
                { from: 'draft', to: 'check', action: 'submit' },
                {
                    from: 'check',
                    to: 'check',
                    action: 'correct',
                    label: { am: 'አስተካክል', en: 'Correct the request' },
                    amendsRequest: true,
                    commentRequired: true
                },
                { from: 'check', to: 'done', action: 'approve' }
            ]
        }
    });
    expect(workflow.statusCode, workflow.body).toBe(201);
    const workflowVersionId = workflow.json<{ latestVersion: { id: string } }>().latestVersion.id;
    for (const [code, form] of [
        [SERVICE, formVersionId],
        [HIDDEN_SERVICE, await publishedForm('hidden-request', HIDDEN_FORM)],
        [RULED_SERVICE, await publishedForm('ruled-request', RULED_FORM)],
        [KEPT_SERVICE, await publishedForm('kept-request', KEPT_FORM)]
    ] as const) {
        const published = await api.call('POST', `/api/v1/services/${code}/versions`, as.bureau, {
            workflowVersionId,
            formVersionId: form
        });
        expect(published.statusCode, published.body).toBe(201);
    }
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('a filed request', () => {
    it('is changed through its case: checked again, what the actor may not see kept, the change on record', async () => {
        const started = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: SERVICE,
            answers: { plate: 'ETH ABC 0042', owner: 'Generated Owner', intakeNote: 'checked the libre' }
        });
        expect(started.statusCode, started.body).toBe(201);
        let c = started.json<CaseOut>();
        const act = async (who: As, body: object) => {
            const res = await api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));
            if (res.statusCode === 200) c = res.json<CaseOut>();
            return res;
        };
        expect((await act(as.damotRecords, { action: 'submit' })).statusCode).toBe(200);
        const { rows: filed } = await api.owner.query<{ id: string; answers: Record<string, unknown> }>(
            'select id, answers from forms.submissions where case_id = $1',
            [c.id]
        );
        const request = filed[0];
        expect(request?.answers).toEqual({
            plate: 'ETH ABC 0042',
            owner: 'Generated Owner',
            intakeNote: 'checked the libre'
        });

        // the head's case page offers the change with the request it fills in again (as the head sees it)
        const page = (await api.call('GET', `/api/v1/cases/${c.id}`, as.damotHead)).json<CaseOut>();
        expect(page.actionDetails.find((a) => a.action === 'correct')).toMatchObject({
            needsForm: true,
            amends: request?.id
        });
        const shown = page.steps.find((s) => s.submissionId === request?.id);
        expect(shown?.answers).toEqual({ plate: 'ETH ABC 0042', owner: 'Generated Owner' });
        expect(page.actionDetails.find((a) => a.action === 'approve')).toMatchObject({ amends: null });

        // only the step's role changes it; a change needs the answers and a comment; an invalid one changes nothing
        const correction = { action: 'correct', comment: 'the plate was misread' };
        expect((await act(as.damotRecords, { ...correction, answers: { plate: 'X', owner: 'Y' } })).statusCode).toBe(
            403
        );
        expect((await act(as.damotHead, correction)).statusCode).toBe(422);
        const invalid = await act(as.damotHead, { ...correction, answers: { plate: 'ETH ABC 0043', owner: '' } });
        expect(invalid.statusCode).toBe(422);
        expect(invalid.json()).toMatchObject({ errors: [{ path: 'owner' }] });

        const changed = await act(as.damotHead, {
            ...correction,
            // a key the head cannot see is no answer of theirs: it is dropped, the stored one kept
            answers: { plate: 'ETH ABC 0043', owner: 'Generated Owner', intakeNote: 'overwritten' }
        });
        expect(changed.statusCode, changed.body).toBe(200);
        expect(c.state).toBe('check');
        // the timeline names the change; the request is still the one filed at the start
        expect(c.events.find((e) => e.action === 'correct')?.amended).toEqual(['plate']);
        expect(c.steps.find((s) => s.submissionId === request?.id)).toMatchObject({
            state: 'draft',
            answers: { plate: 'ETH ABC 0043' }
        });

        const { rows: now } = await api.owner.query<{ answers: Record<string, unknown>; row_version: number }>(
            'select answers, row_version from forms.submissions where id = $1',
            [request?.id]
        );
        expect(now[0]).toEqual({
            answers: { plate: 'ETH ABC 0043', owner: 'Generated Owner', intakeNote: 'checked the libre' },
            row_version: 2
        });
        const { rows: revisions } = await api.owner.query<{ revision: number; answers: unknown }>(
            'select revision, answers from forms.submission_revisions where submission_id = $1',
            [request?.id]
        );
        expect(revisions).toEqual([{ revision: 1, answers: request?.answers }]);
        const { rows: values } = await api.owner.query<{ value_text: string }>(
            "select value_text from forms.submission_values where submission_id = $1 and field_key = 'plate'",
            [request?.id]
        );
        expect(values.map((v) => v.value_text)).not.toContain('ETH ABC 0042');
        const { rows: events } = await api.owner.query<{ action: string; comment: string; data: unknown }>(
            "select action, comment, data from workflow.case_events where case_id = $1 and action = 'correct'",
            [c.id]
        );
        expect(events).toEqual([
            {
                action: 'correct',
                comment: 'the plate was misread',
                data: { submissionId: request?.id, amended: ['plate'] }
            }
        ]);
        // on the audit log: the request's change (its answers only as an HMAC) and the revision kept
        const { rows: audit } = await api.owner.query<{ table_name: string; action: string; diff: unknown }>(
            `select table_name, action, diff from kernel.audit_log
              where row_id = $1 or (table_name = 'forms.submission_revisions' and diff->'after'->>'submissionId' = $1::text)
              order by at, id`,
            [request?.id]
        );
        expect(audit.map((a) => `${a.table_name} ${a.action}`)).toEqual([
            'forms.submissions insert',
            'forms.submission_revisions insert',
            'forms.submissions update'
        ]);
        expect(JSON.stringify(audit)).not.toContain('ETH ABC 0043');

        // the request's history shows the change, and the case goes on
        const history = await api.call('GET', `/api/v1/submissions/${request?.id ?? ''}/history`, as.damotHead);
        expect(history.statusCode, history.body).toBe(200);
        expect(history.json<{ items: { action: string; changes: string[] }[] }>().items[0]).toMatchObject({
            action: 'update',
            changes: ['answers']
        });
        expect((await act(as.damotHead, { action: 'approve' })).statusCode).toBe(200);
    });

    it('never changes outside a case, even for the database role the API runs as', async () => {
        const { rows } = await api.owner.query<{ id: string }>(
            'select id from forms.submissions where case_id is not null limit 1'
        );
        const loose = await api.owner.query<{ id: string }>(
            `insert into forms.submissions (id, region_id, handling_unit_id, form_id, form_version_id, answers)
             select gen_random_uuid(), region_id, handling_unit_id, form_id, form_version_id, '{}'::jsonb
               from forms.submissions where id = $1 returning id`,
            [rows[0]?.id]
        );
        const scope = await api.owner.query<{ region_id: string; org_path: string }>(
            'select region_id, org_path::text from forms.submissions where id = $1',
            [loose.rows[0]?.id]
        );
        const app = new Client({ connectionString: pg.url('app') });
        await app.connect();
        try {
            await app.query('begin');
            await app.query("select set_config('app.region_id', $1, true), set_config('app.scope_path', $2, true)", [
                scope.rows[0]?.region_id,
                scope.rows[0]?.org_path
            ]);
            await expect(
                app.query(`update forms.submissions set answers = '{"plate":"x"}' where id = $1`, [loose.rows[0]?.id])
            ).rejects.toThrow(/only the request of a case/);
        } finally {
            await app.query('rollback');
            await app.end();
        }
    });

    it('is listed to its office and those above, waiting or recent, a page at a time', async () => {
        const file = async () => {
            const res = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
                serviceCode: SERVICE,
                answers: { plate: 'ETH ABC 0100', owner: 'Generated Owner' }
            });
            expect(res.statusCode, res.body).toBe(201);
            return res.json<CaseOut>();
        };
        const first = await file();
        const second = await file();
        const list = async (who: As, query: string) => {
            const res = await api.call('GET', `/api/v1/cases?${query}`, who);
            expect(res.statusCode, res.body).toBe(200);
            return res.json<CaseList>();
        };
        const ids = (l: CaseList) => l.items.map((i) => i.id);

        // waiting: the longest waiting first, with its service as named when it started
        const waiting = await list(as.damotRecords, `service=${SERVICE}&mine=true`);
        expect(ids(waiting).indexOf(first.id)).toBeLessThan(ids(waiting).indexOf(second.id));
        expect(waiting.items.find((i) => i.id === first.id)).toMatchObject({
            number: first.number,
            service: { code: SERVICE },
            state: 'draft',
            closed: false,
            startedByName: expect.any(String) as unknown
        });
        // a page at a time: the cursor is opaque (the page's last case and where it sorts)
        const page1 = await list(as.damotRecords, `service=${SERVICE}&mine=true&limit=1`);
        expect(page1.items).toHaveLength(1);
        expect(page1.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
        const page2 = await list(
            as.damotRecords,
            `service=${SERVICE}&mine=true&limit=1&after=${page1.nextCursor ?? ''}`
        );
        expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
        // recent: the last changed first
        await api.call(
            'POST',
            `/api/v1/cases/${first.id}/transitions`,
            as.damotRecords,
            { action: 'submit' },
            ifMatch(first.version)
        );
        expect(ids(await list(as.damotRecords, `list=recent&service=${SERVICE}`))[0]).toBe(first.id);

        // the zone above sees Damot Gale's requests; Boditi, a sibling, does not; the head started none of them
        expect(ids(await list(as.zoneHead, `number=${first.number}`))).toEqual([first.id]);
        expect(ids(await list(as.boditiHead, `number=${first.number}`))).toEqual([]);
        expect(ids(await list(as.boditiHead, `list=recent&service=${SERVICE}`))).toEqual([]);
        expect(ids(await list(as.damotHead, `mine=true&service=${SERVICE}`))).toEqual([]);
        // another office's cursor gives nothing away; something that is no cursor is refused
        expect((await list(as.boditiHead, `after=${page1.nextCursor ?? ''}`)).items).toEqual([]);
        const forged = await api.call('GET', `/api/v1/cases?after=${first.id}`, as.damotRecords);
        expect(forged.statusCode).toBe(422);
        // a cursor of a day that does not exist is refused too, never a database error
        const impossible = Buffer.from(JSON.stringify(['2026-02-30T00:00:00.000000Z', first.id])).toString('base64url');
        const yearZero = Buffer.from(JSON.stringify(['0000-01-01T00:00:00.000000Z', first.id])).toString('base64url');
        expect((await api.call('GET', `/api/v1/cases?after=${yearZero}`, as.damotRecords)).statusCode).toBe(422);
        expect((await api.call('GET', `/api/v1/cases?after=${impossible}`, as.damotRecords)).statusCode).toBe(422);
    });

    it('keeps the files, the Sensitive answers and the rows its corrector may not see or change', async () => {
        const fileId = randomUUID();
        const damot = as.damotRecords.unit;
        await api.owner.query(
            `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key,
                 confirmed_at, origin, created_by)
             values ($1, $2, $3, 'stored', 'libre.pdf', 'application/pdf', 10, repeat('a', 64), $4, now(), 'upload', $5)`,
            [fileId, damot.regionId, damot.id, `files/${damot.regionId}/${fileId}`, await api.userId(SUB.damotRecords)]
        );
        const started = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: HIDDEN_SERVICE,
            answers: {
                plate: 'ETH ABC 0200',
                phone: '0911000000',
                scan: [{ file_id: fileId }],
                people: [{ name: 'Generated Person', idNo: 'ID-1', checkedBy: 'records' }]
            }
        });
        expect(started.statusCode, started.body).toBe(201);
        let c = started.json<CaseOut>();
        const act = async (body: object, who: As = as.damotHead) => {
            const res = await api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));
            if (res.statusCode === 200) c = res.json<CaseOut>();
            return res;
        };
        expect((await act({ action: 'submit' }, as.damotRecords)).statusCode).toBe(200);
        const stored = async () =>
            (
                await api.owner.query<{ id: string; answers: Record<string, unknown> }>(
                    'select id, answers from forms.submissions where case_id = $1',
                    [c.id]
                )
            ).rows[0];
        const filed = await stored();

        // the corrector sees the request without the Sensitive answers and the restricted column
        const page = (await api.call('GET', `/api/v1/cases/${c.id}`, as.damotHead)).json<CaseOut>();
        const theirs = page.steps.find((s) => s.submissionId === filed?.id)?.answers ?? {};
        expect(theirs).not.toHaveProperty('phone');
        expect(theirs.people).toEqual([{ name: 'Generated Person' }]);

        // sent back as shown, the plate corrected: the file, the phone and the rows stay as filed
        const corrected = await act({
            action: 'correct',
            comment: 'the plate was misread',
            answers: { ...theirs, plate: 'ETH ABC 0201' }
        });
        expect(corrected.statusCode, corrected.body).toBe(200);
        expect(c.events.findLast((e) => e.action === 'correct')?.amended).toEqual(['plate']);
        expect((await stored())?.answers).toEqual({ ...filed?.answers, plate: 'ETH ABC 0201' });

        // the rows cannot be changed by someone who does not see all of them: refused, nothing lost
        const rows = await act({
            action: 'correct',
            comment: 'the name was misspelt',
            answers: { ...theirs, plate: 'ETH ABC 0201', people: [{ name: 'Generated Persons' }] }
        });
        expect(rows.statusCode).toBe(422);
        expect(rows.json()).toMatchObject({ errors: [{ path: 'people', code: 'hidden_answers' }] });

        // a change that changes nothing writes nothing
        const revisions = async () =>
            (await api.owner.query('select 1 from forms.submission_revisions where submission_id = $1', [filed?.id]))
                .rowCount;
        expect(await revisions()).toBe(1);
        const same = await act({
            action: 'correct',
            comment: 'checked again',
            answers: { ...theirs, plate: 'ETH ABC 0201' }
        });
        expect(same.statusCode, same.body).toBe(200);
        expect(c.events.findLast((e) => e.action === 'correct')?.amended).toEqual([]);
        expect(await revisions()).toBe(1);
    });

    it("keeps what other roles' rules show, and never asks for a column nobody here may fill", async () => {
        const started = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: RULED_SERVICE,
            answers: { plate: 'ETH ABC 0300', intakeRemark: 'saw the libre', vehicles: [{ vplate: 'A 1' }] }
        });
        expect(started.statusCode, started.body).toBe(201);
        let c = started.json<CaseOut>();
        const act = async (body: object, who: As = as.damotHead) => {
            const res = await api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));
            if (res.statusCode === 200) c = res.json<CaseOut>();
            return res;
        };
        expect((await act({ action: 'submit' }, as.damotRecords)).statusCode).toBe(200);
        const stored = async () =>
            (
                await api.owner.query<{ answers: Record<string, unknown> }>(
                    'select answers from forms.submissions where case_id = $1',
                    [c.id]
                )
            ).rows[0]?.answers;
        expect(await stored()).toEqual({
            plate: 'ETH ABC 0300',
            intakeRemark: 'saw the libre',
            vehicles: [{ vplate: 'A 1' }]
        });

        // the head's rules hide the remark (it stays as filed); the auditor's required column is no one's here to fill
        const corrected = await act({
            action: 'correct',
            comment: 'plate and vehicle corrected',
            answers: { plate: 'ETH ABC 0301', vehicles: [{ vplate: 'A 2' }] }
        });
        expect(corrected.statusCode, corrected.body).toBe(200);
        expect(c.events.findLast((e) => e.action === 'correct')?.amended).toEqual(['plate', 'vehicles']);
        expect(await stored()).toEqual({
            plate: 'ETH ABC 0301',
            intakeRemark: 'saw the libre',
            vehicles: [{ vplate: 'A 2' }]
        });
    });

    it("keeps Sensitive answers of other roles' rules, follows a derived total, and never hides another role's answer", async () => {
        const started = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: KEPT_SERVICE,
            answers: {
                plate: 'ETH ABC 0400',
                secretNote: 'the owner asked for discretion',
                family: [{ relation: 'spouse' }],
                qty: 2,
                insured: 'yes',
                insuranceNo: 'INS-1'
            }
        });
        expect(started.statusCode, started.body).toBe(201);
        let c = started.json<CaseOut>();
        const act = async (body: object, who: As = as.damotHead) => {
            const res = await api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));
            if (res.statusCode === 200) c = res.json<CaseOut>();
            return res;
        };
        expect((await act({ action: 'submit' }, as.damotRecords)).statusCode).toBe(200);
        const stored = async () =>
            (
                await api.owner.query<{ answers: Record<string, unknown> }>(
                    'select answers from forms.submissions where case_id = $1',
                    [c.id]
                )
            ).rows[0]?.answers;
        const filed = await stored();
        expect(filed).toMatchObject({ total: 4, secretNote: 'the owner asked for discretion' });

        // a Sensitive answer the head's rules hide is kept even when they send one; the derived total follows the quantity
        const corrected = await act({
            action: 'correct',
            comment: 'quantity corrected',
            answers: { plate: 'ETH ABC 0400', secretNote: 'overwritten', qty: 5, insured: 'yes' }
        });
        expect(corrected.statusCode, corrected.body).toBe(200);
        expect(await stored()).toEqual({ ...filed, qty: 5, total: 10 });

        // the Sensitive section's rows are nobody's here to replace
        const family = await act({
            action: 'correct',
            comment: 'relation corrected',
            answers: { plate: 'ETH ABC 0400', qty: 5, insured: 'yes', family: [{ relation: 'child' }] }
        });
        expect(family.statusCode).toBe(422);
        expect(family.json()).toMatchObject({ errors: [{ path: 'family', code: 'hidden_answers' }] });

        // un-insuring would hide the records officer's insurance number: refused, the field not named to the head
        const hide = await act({
            action: 'correct',
            comment: 'not insured',
            answers: { plate: 'ETH ABC 0400', qty: 5, insured: 'no' }
        });
        expect(hide.statusCode).toBe(422);
        expect(hide.json()).toMatchObject({ errors: [{ path: '', code: 'kept_answers' }] });
        expect(await stored()).toEqual({ ...filed, qty: 5, total: 10 });
    });
});
