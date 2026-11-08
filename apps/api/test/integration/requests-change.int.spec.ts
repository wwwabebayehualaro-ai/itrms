/**
 * A filed request changed through its case (task 0.21e), on a real PostgreSQL 16: an action that `amendsRequest` replaces
 * the request's answers, checked again on the version it was filed on; what the actor may not see keeps its answer; the
 * answers it replaced are kept as a revision; the timeline names the fields changed; the request's filterable values are
 * written again; every write is on the audit log. Nobody else changes it, and an invalid change changes nothing. The
 * office's requests are listed across services, waiting or recent, to its subtree only. A request holding files, a
 * Sensitive answer and a repeating section with columns the actor may not see or change keeps all of them as filed.
 */
import { randomUUID } from 'node:crypto';

import { signContext, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { CaseList, CaseOut } from '@itrms/workflow/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { noIds } from './support/answers';
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
/** the request with a column computed from the person who adds the row */
const PERSONAL_SERVICE = 'RS-04';

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
        text('idScan', { type: 'FileUpload', classification: 'sensitive' }),
        text('attachments', { type: 'FileUpload' }),
        // the people are listed unless the corrector says otherwise: hiding them never drops another role's answers
        text('listed'),
        text('people', {
            type: 'FormArray',
            props: {},
            layout: { options: { isContainer: true } },
            behavior: {
                validation: { supported: true },
                visibilityConditions: [{ field: 'listed', operator: 'neq', value: 'no' }]
            }
        }),
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
        // the head's own result, required, with a default the filer never saw
        text('result', { visibleToRoles: ['unit_head'], props: { required: true, value: 'pass' } }),
        text('vehicles', { type: 'FormArray', props: {}, layout: { options: { isContainer: true } } }),
        text('vplate', { parentId: 'vehicles' }),
        text('inspector', { parentId: 'vehicles', required: true, visibleToRoles: ['auditor'] }),
        // a Sensitive column nobody answered: nobody here gives it one
        text('vin', { parentId: 'vehicles', classification: 'sensitive' }),
        // the records officer's check, at its default: no answer that would lock the section
        text('verified', {
            parentId: 'vehicles',
            type: 'InputSwitch',
            props: { value: false },
            visibleToRoles: ['records_officer']
        })
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
        // the same, seen by everyone: the browser sends it computed again, the server computes it itself
        text('double', {
            type: 'InputNumber',
            data: { defaultProps: {}, computed: { expression: '{{= form.qty * 2 }}', readOnly: true } }
        }),
        // rows with a Sensitive column the server computes
        text('incomes', { type: 'FormArray', props: {}, layout: { options: { isContainer: true } } }),
        text('amount', { parentId: 'incomes', type: 'InputNumber' }),
        text('taxDue', {
            parentId: 'incomes',
            type: 'InputNumber',
            classification: 'sensitive',
            data: { defaultProps: {}, computed: { expression: '{{= row.amount * 2 }}', readOnly: true } }
        }),
        // rows whose derived column reads the root's quantity
        text('lines', { type: 'FormArray', props: {}, layout: { options: { isContainer: true } } }),
        text('lineAmount', { parentId: 'lines', type: 'InputNumber' }),
        text('lineTotal', {
            parentId: 'lines',
            type: 'InputNumber',
            data: { defaultProps: {}, computed: { expression: '{{= row.lineAmount * root.qty }}', readOnly: true } }
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
const PERSONAL_FORM = {
    schemaVersion: 2,
    fields: [
        text('plate', { required: true }),
        text('items', { type: 'FormArray', props: {}, layout: { options: { isContainer: true } } }),
        text('item', { parentId: 'items' }),
        // who added the row: computed from the person, never typed (follow-up 180), in a box of the row
        text('itemBox', { type: 'Panel', parentId: 'items', props: {}, layout: { options: { isContainer: true } } }),
        text('addedBy', {
            parentId: 'itemBox',
            data: { defaultProps: {}, computed: { expression: '{{user.id}}', readOnly: true } }
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
        [KEPT_SERVICE, await publishedForm('kept-request', KEPT_FORM)],
        [PERSONAL_SERVICE, await publishedForm('personal-request', PERSONAL_FORM)]
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
            await app.query('select kernel.set_context($1)', [
                signContext(
                    { regionId: scope.rows[0]?.region_id, scopePath: scope.rows[0]?.org_path },
                    TEST_CONTEXT_KEY
                )
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
        const damot = as.damotRecords.unit;
        const upload = async () => {
            const id = randomUUID();
            await api.owner.query(
                `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key,
                     confirmed_at, origin, created_by)
                 values ($1, $2, $3, 'stored', 'libre.pdf', 'application/pdf', 10, repeat('a', 64), $4, now(), 'upload', $5)`,
                [id, damot.regionId, damot.id, `files/${damot.regionId}/${id}`, await api.userId(SUB.damotRecords)]
            );
            return id;
        };
        const fileId = await upload();
        const idScanId = await upload();
        const started = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: HIDDEN_SERVICE,
            answers: {
                plate: 'ETH ABC 0200',
                phone: '0911000000',
                scan: [{ file_id: fileId }],
                idScan: [{ file_id: idScanId }],
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
        expect(theirs.people).toEqual([{ _id: expect.any(String) as unknown, name: 'Generated Person' }]);

        // sent back as shown, the plate corrected: the file, the phone and the rows stay as filed
        const corrected = await act({
            action: 'correct',
            comment: 'the plate was misread',
            answers: { ...theirs, plate: 'ETH ABC 0201' }
        });
        expect(corrected.statusCode, corrected.body).toBe(200);
        expect(c.events.findLast((e) => e.action === 'correct')?.amended).toEqual(['plate']);
        expect((await stored())?.answers).toEqual({ ...filed?.answers, plate: 'ETH ABC 0201' });

        // a file the request holds is never moved: the Sensitive ID scan does not become a visible attachment
        const moved = await act({
            action: 'correct',
            comment: 'attached the scan',
            answers: { ...theirs, plate: 'ETH ABC 0201', attachments: [{ file_id: idScanId }] }
        });
        expect(moved.statusCode).toBe(422);
        expect(moved.json()).toMatchObject({ errors: [{ path: 'attachments', code: 'invalid_file' }] });

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

        // the head corrects a row (ADR-0040): the records officer's column and the Sensitive id stay with their row
        const rowId = (theirs.people as { _id: string }[])[0]?._id;
        const renamed = await act({
            action: 'correct',
            comment: 'the name was misspelt',
            answers: { ...theirs, plate: 'ETH ABC 0201', people: [{ _id: rowId, name: 'Generated Persons' }] }
        });
        expect(renamed.statusCode, renamed.body).toBe(200);
        expect(c.events.findLast((e) => e.action === 'correct')?.amended).toEqual(['people']);
        expect((await stored())?.answers.people).toEqual([
            { _id: rowId, name: 'Generated Persons', idNo: 'ID-1', checkedBy: 'records' }
        ]);

        // a section the change hides with another answer still holds the records officer's answers: refused, nothing lost
        const hidden = await act({
            action: 'correct',
            comment: 'nobody is listed',
            answers: { ...theirs, plate: 'ETH ABC 0201', listed: 'no', people: [{ _id: rowId, name: 'Someone Else' }] }
        });
        expect(hidden.statusCode).toBe(422);
        expect(hidden.json()).toMatchObject({ errors: [{ path: 'people', code: 'hidden_answers' }] });
        expect((await stored())?.answers.people).toEqual([
            { _id: rowId, name: 'Generated Persons', idNo: 'ID-1', checkedBy: 'records' }
        ]);

        // a row added now holds none of another role's answers, and gets its own id
        const added = await act({
            action: 'correct',
            comment: 'a second person',
            answers: {
                ...theirs,
                plate: 'ETH ABC 0201',
                people: [
                    { _id: rowId, name: 'Generated Persons' },
                    { name: 'Second Person', checkedBy: 'forged' }
                ]
            }
        });
        expect(added.statusCode, added.body).toBe(200);
        const people = (await stored())?.answers.people as Record<string, unknown>[];
        expect(people).toHaveLength(2);
        expect(people[1]).toEqual({ _id: expect.any(String) as unknown, name: 'Second Person' });
        expect(people[1]?._id).not.toBe(rowId);

        // a row holding the records officer's answers is never deleted through the change; one holding none may be
        const dropped = await act({
            action: 'correct',
            comment: 'only the second',
            answers: { ...theirs, plate: 'ETH ABC 0201', people: [{ _id: people[1]?._id, name: 'Second Person' }] }
        });
        expect(dropped.statusCode).toBe(422);
        expect(dropped.json()).toMatchObject({ errors: [{ path: 'people', code: 'hidden_answers' }] });
        const second = await act({
            action: 'correct',
            comment: 'the second was a mistake',
            answers: { ...theirs, plate: 'ETH ABC 0201', people: [{ _id: rowId, name: 'Generated Persons' }] }
        });
        expect(second.statusCode, second.body).toBe(200);
        expect((await stored())?.answers.people).toEqual([
            { _id: rowId, name: 'Generated Persons', idNo: 'ID-1', checkedBy: 'records' }
        ]);
    });

    it("keeps what other roles' rules show, and never asks for a column nobody here may fill", async () => {
        const started = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: RULED_SERVICE,
            answers: {
                plate: 'ETH ABC 0300',
                intakeRemark: 'saw the libre',
                vehicles: [{ vplate: 'A 1', verified: false }]
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
        expect(noIds(await stored())).toEqual({
            plate: 'ETH ABC 0300',
            intakeRemark: 'saw the libre',
            vehicles: [{ vplate: 'A 1', verified: false }]
        });

        // a Sensitive column's answer is nobody's to give here
        const vin = await act({
            action: 'correct',
            comment: 'vin added',
            answers: { plate: 'ETH ABC 0301', result: 'pass', vehicles: [{ vplate: 'A 2', vin: 'VIN-1' }] }
        });
        expect(vin.statusCode).toBe(422);
        expect(vin.json()).toMatchObject({ errors: [{ path: 'vehicles', code: 'not_editable' }] });

        // the head's rules hide the remark (it stays as filed); the auditor's required column is no one's here to fill;
        // the head's own result is stored at the default their form showed; the records officer's check, at its default,
        // is left out of the rows (as a filing leaves it: its default stands for it)
        const corrected = await act({
            action: 'correct',
            comment: 'plate and vehicle corrected',
            answers: { plate: 'ETH ABC 0301', result: 'pass', vehicles: [{ vplate: 'A 2' }] }
        });
        expect(corrected.statusCode, corrected.body).toBe(200);
        expect(c.events.findLast((e) => e.action === 'correct')?.amended).toEqual(['plate', 'result', 'vehicles']);
        expect(noIds(await stored())).toEqual({
            plate: 'ETH ABC 0301',
            intakeRemark: 'saw the libre',
            result: 'pass',
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
                lines: [{ lineAmount: 3 }],
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
        expect(filed).toMatchObject({
            total: 4,
            double: 4,
            lines: [{ lineAmount: 3, lineTotal: 6 }],
            secretNote: 'the owner asked for discretion'
        });

        // a Sensitive answer is nobody's to change here: sent changed, it is refused by name (nothing changes)
        const secret = await act({
            action: 'correct',
            comment: 'note corrected',
            answers: { plate: 'ETH ABC 0400', secretNote: 'overwritten', qty: 5, insured: 'yes' }
        });
        expect(secret.statusCode).toBe(422);
        expect(secret.json()).toMatchObject({ errors: [{ path: 'secretNote', code: 'not_editable' }] });
        expect(await stored()).toEqual(filed);

        // left out (the head's form shows it masked), it stays as filed; the derived fields follow the quantity, the
        // rows' derived column too, and what the browser computed for one is no answer
        const corrected = await act({
            action: 'correct',
            comment: 'quantity corrected',
            answers: {
                plate: 'ETH ABC 0400',
                qty: 5,
                double: 10,
                insured: 'yes',
                lines: [{ lineAmount: 3, lineTotal: 6 }],
                // a row as the browser sends it: its Sensitive computed column computed there too
                incomes: [{ amount: 100, taxDue: 200 }]
            }
        });
        expect(corrected.statusCode, corrected.body).toBe(200);
        const recomputed = {
            ...filed,
            qty: 5,
            total: 10,
            double: 10,
            lines: [{ lineAmount: 3, lineTotal: 15 }],
            incomes: [{ amount: 100, taxDue: 200 }]
        };
        expect(noIds(await stored())).toEqual(noIds(recomputed));

        // the Sensitive section's rows are nobody's here to replace
        const family = await act({
            action: 'correct',
            comment: 'relation corrected',
            answers: { plate: 'ETH ABC 0400', qty: 5, insured: 'yes', family: [{ relation: 'child' }] }
        });
        expect(family.statusCode).toBe(422);
        expect(family.json()).toMatchObject({ errors: [{ path: 'family', code: 'not_editable' }] });

        // a change is a patch: un-insuring leaves the records officer's insurance number as filed (it is theirs, and
        // the revision keeps every earlier state); nothing the head may not see is named or probed
        const uninsured = await act({
            action: 'correct',
            comment: 'not insured',
            answers: { plate: 'ETH ABC 0400', qty: 5, insured: 'no' }
        });
        expect(uninsured.statusCode, uninsured.body).toBe(200);
        expect(c.events.findLast((e) => e.action === 'correct')?.amended).toEqual(['insured']);
        expect(noIds(await stored())).toEqual(noIds({ ...recomputed, insured: 'no' }));
    });

    it('reads rows filed before row ids, keeps such a section whole as before, and gives its rows ids once changed', async () => {
        const started = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: HIDDEN_SERVICE,
            answers: { plate: 'ETH ABC 0400', people: [{ name: 'Earlier Person', idNo: 'ID-9', checkedBy: 'records' }] }
        });
        expect(started.statusCode, started.body).toBe(201);
        let c = started.json<CaseOut>();
        const act = async (body: object) => {
            const res = await api.call(
                'POST',
                `/api/v1/cases/${c.id}/transitions`,
                as.damotHead,
                body,
                ifMatch(c.version)
            );
            if (res.statusCode === 200) c = res.json<CaseOut>();
            return res;
        };
        const submitted = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.damotRecords,
            { action: 'submit' },
            ifMatch(c.version)
        );
        expect(submitted.statusCode, submitted.body).toBe(200);
        c = submitted.json<CaseOut>();
        // the rows as a request filed before ADR-0040 holds them: no ids
        const earlier = [{ name: 'Earlier Person', idNo: 'ID-9', checkedBy: 'records' }];
        await api.owner.query(
            `update forms.submissions set answers = jsonb_set(answers, '{people}', $2::jsonb) where case_id = $1`,
            [c.id, JSON.stringify(earlier)]
        );
        const stored = async () =>
            (
                await api.owner.query<{ answers: Record<string, unknown> }>(
                    'select answers from forms.submissions where case_id = $1',
                    [c.id]
                )
            ).rows[0]?.answers;
        const shown = async () => {
            const page = (await api.call('GET', `/api/v1/cases/${c.id}`, as.damotHead)).json<CaseOut>();
            return page.steps.find((s) => s.answers && 'plate' in s.answers)?.answers ?? {};
        };

        // still readable (G3), and its rows cannot be changed by someone who does not see all of them
        const theirs = await shown();
        expect(theirs.people).toEqual([{ name: 'Earlier Person' }]);
        const refused = await act({
            action: 'correct',
            comment: 'the name was misspelt',
            answers: { ...theirs, people: [{ name: 'Earlier Persons' }] }
        });
        expect(refused.statusCode).toBe(422);
        expect(refused.json()).toMatchObject({ errors: [{ path: 'people', code: 'hidden_answers' }] });
        expect(await stored()).toMatchObject({ people: earlier });

        // sent back as shown: no change, no revision (ids alone are none)
        const same = await act({ action: 'correct', comment: 'looked again', answers: theirs });
        expect(same.statusCode, same.body).toBe(200);
        expect(c.events.findLast((e) => e.action === 'correct')?.amended).toEqual([]);
        expect(await stored()).toMatchObject({ people: earlier });

        // another answer changed: the rows get their ids with it, and only the plate is named as changed
        const plate = await act({
            action: 'correct',
            comment: 'the plate was misread',
            answers: { ...theirs, plate: 'ETH ABC 0401' }
        });
        expect(plate.statusCode, plate.body).toBe(200);
        expect(c.events.findLast((e) => e.action === 'correct')?.amended).toEqual(['plate']);
        expect((await stored())?.people).toEqual([{ _id: expect.any(String) as unknown, ...earlier[0] }]);

        // from then on a row is merged by its id
        const again = await shown();
        const renamed = await act({
            action: 'correct',
            comment: 'the name was misspelt',
            answers: {
                ...again,
                people: (again.people as Record<string, unknown>[]).map((r) => ({ ...r, name: 'Earlier Persons' }))
            }
        });
        expect(renamed.statusCode, renamed.body).toBe(200);
        expect(noIds((await stored())?.people)).toEqual([{ ...earlier[0], name: 'Earlier Persons' }]);
    });

    it('keeps who added a row as filed, and names the corrector on a row they add (follow-up 180)', async () => {
        const started = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: PERSONAL_SERVICE,
            answers: { plate: 'ETH ABC 0500', items: [{ item: 'Tyre' }] }
        });
        expect(started.statusCode, started.body).toBe(201);
        let c = started.json<CaseOut>();
        const submitted = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.damotRecords,
            { action: 'submit' },
            ifMatch(c.version)
        );
        expect(submitted.statusCode, submitted.body).toBe(200);
        c = submitted.json<CaseOut>();
        const records = await api.userId(SUB.damotRecords);
        const head = await api.userId(SUB.damotHead);
        const stored = async () =>
            (
                await api.owner.query<{ answers: Record<string, unknown> }>(
                    'select answers from forms.submissions where case_id = $1',
                    [c.id]
                )
            ).rows[0]?.answers;
        expect(noIds(await stored())).toEqual({ plate: 'ETH ABC 0500', items: [{ item: 'Tyre', addedBy: records }] });

        // the head's change to the rows is theirs to make, though the column reads another person for them
        const page = (await api.call('GET', `/api/v1/cases/${c.id}`, as.damotHead)).json<CaseOut>();
        const theirs = page.steps.find((s) => s.answers && 'plate' in s.answers)?.answers ?? {};
        const [tyre] = theirs.items as Record<string, unknown>[];
        const changed = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.damotHead,
            {
                action: 'correct',
                comment: 'a spare tyre, and a jack',
                answers: {
                    ...theirs,
                    items: [
                        { ...tyre, item: 'Spare tyre', addedBy: head },
                        { item: 'Jack', addedBy: records }
                    ]
                }
            },
            ifMatch(c.version)
        );
        expect(changed.statusCode, changed.body).toBe(200);
        expect(changed.json<CaseOut>().events.findLast((e) => e.action === 'correct')?.amended).toEqual(['items']);
        const items = (await stored())?.items as Record<string, unknown>[];
        expect(items).toEqual([
            { _id: tyre?._id, item: 'Spare tyre', addedBy: records },
            { _id: expect.any(String) as unknown, item: 'Jack', addedBy: head }
        ]);

        // rows filed before ids: who added each cannot be kept by row, so the section stays as filed (the earlier rule)
        await api.owner.query(
            `update forms.submissions set answers = jsonb_set(answers, '{items}', $2::jsonb) where case_id = $1`,
            [c.id, JSON.stringify([{ item: 'Spare tyre', addedBy: records }])]
        );
        const later = (await api.call('GET', `/api/v1/cases/${c.id}`, as.damotHead)).json<CaseOut>();
        const again = later.steps.find((s) => s.answers && 'plate' in s.answers)?.answers ?? {};
        const legacy = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.damotHead,
            {
                action: 'correct',
                comment: 'a wheel',
                answers: { ...again, items: [{ item: 'Wheel', addedBy: records }] }
            },
            ifMatch(later.version)
        );
        expect(legacy.statusCode).toBe(422);
        expect(legacy.json()).toMatchObject({ errors: [{ path: 'items', code: 'not_editable' }] });
        expect((await stored())?.items).toEqual([{ item: 'Spare tyre', addedBy: records }]);
    });
});
