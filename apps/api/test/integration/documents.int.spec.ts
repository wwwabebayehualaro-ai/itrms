/**
 * Documents (task 0.23a, ADR-0044), on a real PostgreSQL 16 and the S3 store. A receipt's document is issued when the receipt
 * is; a workflow's effect issues a case's copy of its application, once. What was issued is frozen: the PDF worker makes the
 * PDF from that, and a reprint returns the stored file, never a new one. An applicant's markup prints as text. Only who may read
 * the unit's documents reads them; nothing renders in the API (a dependency rule keeps Chrome out of it).
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';

import { DocumentsService } from '@itrms/documents/api';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { issueReceiptDocument } from '@itrms/documents/api/worker';
import { findChrome, PdfRenderer, renderIssuedDocument, type PdfWorkerDeps } from '@itrms/documents/api/pdf-worker';
import { PaymentsService } from '@itrms/fees/api';
import { importFeeRules } from '@itrms/fees/seed';
import { S3ObjectStore } from '@itrms/integrations/api';
import { feeRuleSchema } from '@itrms/schemas';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { SettingsService } from '@itrms/kernel/settings';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000d401',
    boditiHead: '0199f0a0-d000-7000-8000-000000000301',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    boditiCashier: '0199f0a0-d000-7000-8000-000000000303',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202'
};
/** a service whose submit issues the copy of its application; one paid at the till */
const COPY = 'RS-04';
const PAID = 'RS-05';

const S3 = {
    endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:18333',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'itrms-test',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: true
};

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
let store: S3ObjectStore;
let renderer: PdfRenderer;
let worker: PdfWorkerDeps;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const t = (en: string) => ({ am: en, en });

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: t(id),
    classification: 'personal',
    props: extra.required ? { required: true } : {},
    behavior: { validation: { supported: true } },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'required'))
});
const FORM = {
    schemaVersion: 2,
    fields: [
        field('applicant', 'InputText', { required: true }),
        field('nationalId', 'InputText', { classification: 'sensitive' }),
        field('grade', 'Dropdown', {
            required: true,
            data: {
                dataSource: {
                    staticData: [
                        { label: t('Automobile'), value: 'auto' },
                        { label: t('Public 1'), value: 'public-1' }
                    ]
                }
            }
        }),
        { id: 'fee', type: 'Fee', category: 'Data', label: t('Fee'), props: { showLines: true } }
    ]
};
const RULE = {
    schemaVersion: 1 as const,
    demo: true,
    inputs: { grade: { kind: 'choice' as const } },
    lines: [
        {
            key: 'base',
            label: t('Licence'),
            kind: 'table' as const,
            input: 'grade',
            rows: [
                { value: 'auto', amount: '30000' },
                { value: 'public-1', amount: '45000' }
            ]
        },
        { key: 'card', label: t('Card'), kind: 'fixed' as const, amount: '10000' }
    ]
};
const review = { key: 'review', kind: 'task', label: t('Review'), assignee: { role: 'unit_head', unit: 'handling' } };
const COPY_FLOW = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        review,
        { key: 'done', kind: 'end', label: t('Done') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: ['documents.issue:application-copy'] },
        {
            from: 'review',
            to: 'review',
            action: 'again',
            label: t('Again'),
            effects: ['documents.issue:application-copy']
        },
        { from: 'review', to: 'done', action: 'approve' }
    ]
};
const PAID_FLOW = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        review,
        { key: 'done', kind: 'end', label: t('Done') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: ['fees.createPaymentOrder'] },
        { from: 'review', to: 'done', action: 'approve' }
    ]
};

async function publishedForm(key: string): Promise<string> {
    const created = await api.call('POST', '/api/v1/forms', as.bureau, { key, name: t(key), document: FORM });
    expect(created.statusCode, created.body).toBe(201);
    const asked = await api.call(
        'POST',
        `/api/v1/forms/${created.json<{ id: string }>().id}/publications`,
        as.bureau,
        {}
    );
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

async function publishService(code: string, key: string, definition: object, form: string, rule: string) {
    const wf = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, { key, name: t(key), definition });
    expect(wf.statusCode, wf.body).toBe(201);
    const published = await api.call('POST', `/api/v1/services/${code}/versions`, as.bureau, {
        workflowVersionId: wf.json<{ latestVersion: { id: string } }>().latestVersion.id,
        formVersionId: form,
        feeRuleVersionId: rule,
        overridePolicy: {}
    });
    expect(published.statusCode, published.body).toBe(201);
}

async function filed(code: string, applicant = 'Generated Applicant'): Promise<CaseOut> {
    const answers = { applicant, nationalId: `SECRET${String(randomInt(1000, 10_000))}`, grade: 'auto' };
    const shown = (
        await api.call('POST', '/api/v1/fees/preview', as.boditiRecords, { serviceCode: code, answers })
    ).json<{ feeRuleVersionId: string; totalSantim: string }>();
    const started = await api.call('POST', '/api/v1/service-requests', as.boditiRecords, {
        serviceCode: code,
        answers,
        fee: { ruleVersionId: shown.feeRuleVersionId, totalSantim: shown.totalSantim }
    });
    expect(started.statusCode, started.body).toBe(201);
    const c = started.json<CaseOut>();
    const submitted = await api.call(
        'POST',
        `/api/v1/cases/${c.id}/transitions`,
        as.boditiRecords,
        { action: 'submit' },
        ifMatch(c.version)
    );
    expect(submitted.statusCode, submitted.body).toBe(200);
    return submitted.json<CaseOut>();
}

/** A case paid at the till, and its receipt's id. */
async function receipted(): Promise<{ caseId: string; receiptId: string; number: string }> {
    const c = await filed(PAID);
    const order = (await api.call('GET', `/api/v1/cases/${c.id}/payment`, as.boditiCashier)).json<{ id: string }>();
    const paid = await api.call(
        'POST',
        `/api/v1/payment-orders/${order.id}/payments`,
        as.boditiCashier,
        { method: 'cash', amountSantim: '40000', receivedFrom: 'Generated Applicant' },
        { 'idempotency-key': randomUUID() }
    );
    expect(paid.statusCode, paid.body).toBe(201);
    const { receipt } = paid.json<{ receipt: { id: string; number: string } }>();
    return { caseId: c.id, receiptId: receipt.id, number: receipt.number };
}

interface Doc {
    id: string;
    templateKey: string;
    state: string;
    number: string | null;
    failure: string | null;
}
const docsOf = async (query: string, who: As = as.boditiRecords) => {
    const res = await api.call('GET', `/api/v1/issued-documents?${query}`, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ items: Doc[] }>().items;
};
const rowOf = async (id: string) =>
    (
        await api.owner.query<{ state: string; sha256: string | null; file_id: string | null; data: unknown }>(
            'select state, sha256, file_id, data from documents.issued_documents where id = $1',
            [id]
        )
    ).rows[0];
const count = async (sql: string, params: unknown[] = []) =>
    (await api.owner.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;
const receiptSource = () => ({
    receipt: (tx: Parameters<PaymentsService['receipt']>[0], id: string) =>
        api.http.get(PaymentsService).receipt(tx, id),
    settings: api.http.get(SettingsService)
});

beforeAll(async () => {
    if (!S3.accessKeyId || !S3.secretAccessKey) throw new Error('S3 credentials missing: run pnpm dev:infra');
    const chrome = findChrome();
    if (!chrome) throw new Error('Chrome missing: set CHROME_PATH');
    pg = await startPostgres();
    store = new S3ObjectStore({ ...S3 });
    renderer = new PdfRenderer({ executablePath: chrome, noSandbox: process.env.CHROME_NO_SANDBOX === '1' });
    api = await startApi(
        pg,
        [
            {
                username: 'test.bureau.docs',
                sub: SUB.bureau2,
                region: 'SER',
                home: 'SER',
                roles: [['SER', 'bureau_admin']]
            }
        ],
        { objectStore: store }
    );
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    worker = { store, renderer };
    const region = await api.unit('SER', 'SER');
    const zone = await api.unit('SER', 'WOL');
    const boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.boditiHead = { sub: SUB.boditiHead, unit: boditi };
    as.boditiRecords = { sub: SUB.boditiRecords, unit: boditi };
    as.boditiCashier = { sub: SUB.boditiCashier, unit: boditi };
    as.zoneHead = { sub: SUB.zoneHead, unit: zone };
    as.damotRecords = { sub: SUB.damotRecords, unit: await api.unit('SER', 'WOL-DAMOT-GALE') };

    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, { id: region.id, regionId: region.regionId }, [
            { key: 'licence-demo', name: t('Licence (demo)'), document: feeRuleSchema.parse(RULE) }
        ]);
        await importDocumentTemplates(tx, { id: region.id, regionId: region.regionId });
    });
    const { rows } = await api.owner.query<{ id: string }>(
        `select v.id from fees.fee_rule_versions v join fees.fee_rules r on r.latest_version_id = v.id
          where r.key = 'licence-demo'`
    );
    const rule = rows[0]?.id ?? '';
    const form = await publishedForm('licence-request');
    await publishService(COPY, 'copy-flow', COPY_FLOW, form, rule);
    await publishService(PAID, 'paid-flow', PAID_FLOW, form, rule);
}, 240_000);

afterAll(async () => {
    await renderer?.close();
    await system?.close();
    await api?.close();
    await pg?.stop();
});

describe('a receipt', () => {
    it('gets its document when it is issued: once, with its number, its PDF made by the worker', async () => {
        const { caseId, receiptId, number } = await receipted();
        expect(await docsOf(`subjectId=${receiptId}`)).toEqual([]);

        expect(await issueReceiptDocument(system, receiptSource(), receiptId)).toBe(true);
        // a delivery again: the same document
        expect(await issueReceiptDocument(system, receiptSource(), receiptId)).toBe(true);
        const [doc, ...more] = await docsOf(`subjectId=${receiptId}`);
        expect(more).toEqual([]);
        expect(doc).toMatchObject({ templateKey: 'receipt', state: 'requested', number });
        expect(await docsOf(`caseId=${caseId}`)).toHaveLength(1);

        // the PDF worker's event, not the main worker's; not ready yet
        const id = doc?.id ?? '';
        expect(
            await count(
                `select count(*)::int as n from kernel.outbox_events
                  where type = 'document.render.v1' and payload ->> 'documentId' = $1`,
                [id]
            )
        ).toBe(1);
        expect((await api.call('GET', `/api/v1/issued-documents/${id}/download`, as.boditiRecords)).statusCode).toBe(
            409
        );

        expect(await renderIssuedDocument(system, worker, id)).toBe('rendered');
        const stored = await rowOf(id);
        expect(stored?.state).toBe('rendered');

        // a reprint is the stored file: rendering again does nothing, and the bytes are the ones it recorded
        expect(await renderIssuedDocument(system, worker, id)).toBe('nothing');
        const again = await rowOf(id);
        expect(again?.file_id).toBe(stored?.file_id);
        const link = await api.call('GET', `/api/v1/issued-documents/${id}/download`, as.boditiRecords);
        expect(link.statusCode, link.body).toBe(200);
        const bytes = new Uint8Array(await (await fetch(link.json<{ url: string }>().url)).arrayBuffer());
        expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(stored?.sha256);
        // and it is on record who printed it
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log where event_type = 'document.printed' and row_id = $1`,
                [id]
            )
        ).toBe(1);
    }, 120_000);

    it('keeps its money when the region has no template yet', async () => {
        const { receiptId } = await receipted();
        const key = `receipt-${randomUUID().slice(0, 6)}`;
        await api.owner.query(`update documents.document_templates set key = $1 where key = 'receipt'`, [key]);
        try {
            expect(await issueReceiptDocument(system, receiptSource(), receiptId)).toBe(false);
            expect(await docsOf(`subjectId=${receiptId}`)).toEqual([]);
        } finally {
            await api.owner.query(`update documents.document_templates set key = 'receipt' where key = $1`, [key]);
        }
    });
});

describe('a workflow', () => {
    it('issues the case its application copy, once: no sensitive answer, and an applicant’s script as text', async () => {
        const c = await filed(COPY, '<script>alert("x")</script>');
        const [doc, ...more] = await docsOf(`caseId=${c.id}`);
        expect(more).toEqual([]);
        expect(doc).toMatchObject({ templateKey: 'application-copy', state: 'requested' });

        const id = doc?.id ?? '';
        const row = await rowOf(id);
        const data = JSON.stringify(row?.data);
        expect(data).toContain('<script>alert');
        expect(data).toContain('Automobile');
        expect(data).not.toContain('SECRET');
        expect(data).not.toContain('nationalId');

        // what the worker hands Chrome has it escaped
        let html = '';
        const seen: PdfWorkerDeps = {
            store,
            renderer: {
                render: (page, paper) => {
                    html = page;
                    return renderer.render(page, paper);
                }
            }
        };
        expect(await renderIssuedDocument(system, seen, id)).toBe('rendered');
        expect(html).not.toContain('<script>alert');
        expect(html).toContain('&lt;script&gt;alert');

        // a step taken again: the same document
        const page = await api.call('GET', `/api/v1/cases/${c.id}`, as.boditiHead);
        const again = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.boditiHead,
            { action: 'again' },
            ifMatch(page.json<CaseOut>().version)
        );
        expect(again.statusCode, again.body).toBe(200);
        expect(await docsOf(`caseId=${c.id}`)).toHaveLength(1);
    }, 120_000);

    it('has its transition refused for a document this slice can’t build', async () => {
        const version = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
            key: 'bad-document-flow',
            name: t('Bad'),
            definition: {
                ...COPY_FLOW,
                transitions: [
                    { from: 'draft', to: 'review', action: 'submit', effects: ['documents.issue:licence-card'] },
                    { from: 'review', to: 'done', action: 'approve' }
                ]
            }
        });
        expect(version.statusCode, version.body).toBe(201);
        const form = await publishedForm('another-request');
        const published = await api.call('POST', '/api/v1/services/RS-06/versions', as.bureau, {
            workflowVersionId: version.json<{ latestVersion: { id: string } }>().latestVersion.id,
            formVersionId: form,
            feeRuleVersionId: (
                await api.owner.query<{ id: string }>(
                    `select v.id from fees.fee_rule_versions v join fees.fee_rules r on r.latest_version_id = v.id
                      where r.key = 'licence-demo'`
                )
            ).rows[0]?.id,
            overridePolicy: {}
        });
        expect(published.statusCode, published.body).toBe(201);
        const answers = { applicant: 'Generated Applicant', grade: 'auto' };
        const shown = (
            await api.call('POST', '/api/v1/fees/preview', as.boditiRecords, { serviceCode: 'RS-06', answers })
        ).json<{ feeRuleVersionId: string; totalSantim: string }>();
        const c = (
            await api.call('POST', '/api/v1/service-requests', as.boditiRecords, {
                serviceCode: 'RS-06',
                answers,
                fee: { ruleVersionId: shown.feeRuleVersionId, totalSantim: shown.totalSantim }
            })
        ).json<CaseOut>();
        const refused = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.boditiRecords,
            { action: 'submit' },
            ifMatch(c.version)
        );
        expect(refused.statusCode).toBe(409);
        expect(refused.json()).toMatchObject({ code: 'not_configured' });
    });
});

describe('a document', () => {
    it('is read within the unit’s subtree and with the right', async () => {
        const c = await filed(COPY);
        const [doc] = await docsOf(`caseId=${c.id}`);
        const id = doc?.id ?? '';
        await renderIssuedDocument(system, worker, id);
        // the zone above sees it; another woreda does not; nobody gets its link across that line
        expect(await docsOf(`caseId=${c.id}`, as.zoneHead)).toHaveLength(1);
        expect(await docsOf(`caseId=${c.id}`, as.damotRecords)).toEqual([]);
        expect((await api.call('GET', `/api/v1/issued-documents/${id}/download`, as.damotRecords)).statusCode).toBe(
            404
        );
        expect((await api.call('GET', `/api/v1/issued-documents/${id}/download`, as.zoneHead)).statusCode).toBe(200);
        // the generic files route still refuses a generated file made for nobody in particular
        const row = await rowOf(id);
        expect((await api.call('GET', `/api/v1/files/${row?.file_id ?? ''}`, as.boditiRecords)).statusCode).toBe(404);
    }, 120_000);

    it('keeps what was issued: data out of the audit log, and no change after it is made', async () => {
        const c = await filed(COPY, 'Applicant Kept Out Of The Log');
        const [doc] = await docsOf(`caseId=${c.id}`);
        const id = doc?.id ?? '';
        const logged = await api.owner.query<{ diff: unknown }>(
            `select diff from kernel.audit_log where table_name = 'documents.issued_documents' and row_id = $1`,
            [id]
        );
        expect(logged.rows.length).toBeGreaterThan(0);
        expect(JSON.stringify(logged.rows)).not.toContain('Kept Out Of The Log');
        await expect(
            api.owner.query(`update documents.issued_documents set language = 'en' where id = $1`, [id])
        ).rejects.toThrow(/keeps what was issued/);
        await renderIssuedDocument(system, worker, id);
        await expect(
            api.owner.query(
                `update documents.issued_documents set state = 'requested', file_id = null, sha256 = null where id = $1`,
                [id]
            )
        ).rejects.toThrow(/keeps what was issued/);
        await expect(api.owner.query(`delete from documents.issued_documents where id = $1`, [id])).rejects.toThrow(
            /keeps what was issued/
        );
        await expect(
            api.owner.query(`update documents.document_template_versions set body = 'x' where number = 1`)
        ).rejects.toThrow(/append-only/);
    }, 120_000);

    it('that its template can’t print fails on record, and is not tried for ever', async () => {
        const c = await filed(COPY);
        const [doc] = await docsOf(`caseId=${c.id}`);
        const id = doc?.id ?? '';
        const [{ region_id: regionId, owner_unit_id: owner }] = (
            await api.owner.query<{ region_id: string; owner_unit_id: string }>(
                `select region_id, owner_unit_id from documents.document_templates where key = 'application-copy'`
            )
        ).rows as [{ region_id: string; owner_unit_id: string }];
        const template = (
            await api.owner.query<{ id: string }>(
                `insert into documents.document_templates (id, region_id, owner_unit_id, key, name)
                 values (gen_random_uuid(), $1, $2, $3, '{"am":"x","en":"x"}') returning id`,
                [regionId, owner, `broken-${randomUUID().slice(0, 6)}`]
            )
        ).rows[0]?.id;
        const version = (
            await api.owner.query<{ id: string }>(
                `insert into documents.document_template_versions
                    (id, region_id, owner_unit_id, template_id, number, content_hash, body, strings, paper, data_schema)
                 values (gen_random_uuid(), $1, $2, $3, 1, 'broken', '{{ x | nothing }}', '{}', 'A4', 'application-copy.v1')
                 returning id`,
                [regionId, owner, template]
            )
        ).rows[0]?.id;
        const broken = (
            await api.owner.query<{ id: string }>(
                `insert into documents.issued_documents (id, region_id, handling_unit_id, template_id, template_version_id,
                     language, data, header, office_name)
                 select gen_random_uuid(), region_id, handling_unit_id, $1, $2, language, data, header, office_name
                   from documents.issued_documents where id = $3 returning id`,
                [template, version, id]
            )
        ).rows[0]?.id;
        expect(await renderIssuedDocument(system, worker, broken ?? '')).toBe('failed');
        expect(await rowOf(broken ?? '')).toMatchObject({ state: 'failed', file_id: null });
    }, 120_000);

    it('uses the header its unit inherits, as it was when issued', async () => {
        const zone = as.zoneHead.unit;
        const set = await api.call(
            'PUT',
            `/api/v1/org-units/${zone.id}/settings/documents.header`,
            as.bureau,
            { value: { title: { am: 'የናሙና ዞን መምሪያ', en: 'Sample Zone Department' } } },
            ifMatch(0)
        );
        expect(set.statusCode, set.body).toBe(200);
        try {
            const c = await filed(COPY);
            const [doc] = await docsOf(`caseId=${c.id}`);
            const { rows } = await api.owner.query<{ header: { title?: { en?: string } } }>(
                'select header from documents.issued_documents where id = $1',
                [doc?.id]
            );
            expect(rows[0]?.header.title?.en).toBe('Sample Zone Department');
        } finally {
            await api.call(
                'DELETE',
                `/api/v1/org-units/${zone.id}/settings/documents.header`,
                as.bureau,
                undefined,
                ifMatch(1)
            );
        }
    });

    it('can be issued by a work process, against the shape its template names', async () => {
        const region = as.bureau.unit;
        const boditi = as.boditiRecords.unit;
        const issue = (data: Record<string, unknown>) =>
            api.installer.scoped({}, (tx) =>
                api.http.get(DocumentsService).issue(tx, {
                    regionId: region.regionId,
                    handlingUnitId: boditi.id,
                    templateKey: 'licence-card',
                    language: 'am',
                    data
                })
            );
        await expect(issue({ number: 'SER-1' })).rejects.toMatchObject({ code: 'contract_unmet' });
    });
});
