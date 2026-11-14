/**
 * Documents (task 0.23a, ADR-0044), on a real PostgreSQL 16 and the S3 store. A receipt's document is issued when the receipt
 * is; a workflow's effect issues a case's copy of its application, once. What was issued is frozen: the PDF worker makes the
 * PDF from that, and a reprint returns the stored file, never a new one. An applicant's markup prints as text. Only who may read
 * the unit's documents reads them; nothing renders in the API (a dependency rule keeps Chrome out of it).
 */
import { createHash, createPublicKey, randomBytes, randomInt, randomUUID, verify as cryptoVerify } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DocumentsService } from '@itrms/documents/api';
import {
    encodeBase64Url,
    payloadBytes,
    signedBytes,
    verificationUrl,
    type VerificationPayload
} from '@itrms/documents/contracts';
import { addisToday, checkQr, type PublishedKey } from '@itrms/documents/contracts/verification-check';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { issueReceiptDocument, revokeReceiptDocument } from '@itrms/documents/api/worker';
import {
    currentSigningKey,
    signPayload,
    findChrome,
    PdfRenderer,
    renderIssuedDocument,
    type PdfWorkerDeps
} from '@itrms/documents/api/pdf-worker';
import { PaymentsService } from '@itrms/fees/api';
import { importFeeRules } from '@itrms/fees/seed';
import { S3ObjectStore } from '@itrms/integrations/api';
import { feeRuleSchema } from '@itrms/schemas';
import { FieldCrypto } from '@itrms/kernel/crypto';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { SettingsService } from '@itrms/kernel/settings';
import type { CaseOut } from '@itrms/workflow/contracts';
import { Client } from 'pg';
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
    zoneFinance: '0199f0a0-d000-7000-8000-000000000108',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202'
};
/** a service whose submit issues the copy of its application; one paid at the till */
const COPY = 'RS-04';
const PAID = 'RS-05';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'infra', 'compose', '.env');
if (!process.env.S3_ACCESS_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
const S3 = {
    endpoint: process.env.S3_ENDPOINT ?? `http://127.0.0.1:${process.env.S3_HOST_PORT ?? '18333'}`,
    bucket: process.env.S3_BUCKET ?? 'itrms-test',
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? ''
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
        // inside a Sensitive section, though only personal itself: as sensitive as its container
        {
            id: 'privateGroup',
            type: 'Panel',
            label: t('Private'),
            classification: 'sensitive',
            props: {},
            layout: { options: { isContainer: true } }
        },
        { ...field('motherName', 'InputText'), parentId: 'privateGroup' },
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
    const answers = {
        applicant,
        nationalId: `SECRET${String(randomInt(1000, 10_000))}`,
        motherName: 'SECRET-MOTHER',
        grade: 'auto'
    };
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
    worker = {
        store,
        renderer,
        crypto: new FieldCrypto({ fieldKeys: `k1:${randomBytes(32).toString('base64')}` }),
        verifyBaseUrl: 'https://verify.example.test'
    };
    const region = await api.unit('SER', 'SER');
    const zone = await api.unit('SER', 'WOL');
    const boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.boditiHead = { sub: SUB.boditiHead, unit: boditi };
    as.boditiRecords = { sub: SUB.boditiRecords, unit: boditi };
    as.boditiCashier = { sub: SUB.boditiCashier, unit: boditi };
    as.zoneHead = { sub: SUB.zoneHead, unit: zone };
    as.zoneFinance = { sub: SUB.zoneFinance, unit: zone };
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
        expect(data).not.toContain('motherName');

        // what the worker hands Chrome has it escaped
        let html = '';
        const seen: PdfWorkerDeps = {
            ...worker,
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
            api.owner.query(`update documents.issued_documents set number = 'changed' where id = $1`, [id])
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
            // the builder's print preview (task 1.13e) shows an office under the same header its documents print
            const shown = await api.call('GET', '/api/v1/document-header', as.boditiRecords);
            expect(shown.statusCode, shown.body).toBe(200);
            expect(shown.json<Record<string, unknown>>()).toMatchObject({
                title: { en: 'Sample Zone Department' },
                subtitle: null,
                logo: null
            });
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
            api.installer.scoped({ requestId: 'system:test' }, (tx) =>
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

describe('a document’s QR', () => {
    /** Renders a document, keeping the page Chrome was given: its QR's address, as a phone would read it. */
    const rendered = async (id: string): Promise<{ url: URL; token: string; payload: Buffer; signature: Buffer }> => {
        let html = '';
        const seeing: PdfWorkerDeps = {
            ...worker,
            renderer: {
                render: (page, paper) => {
                    html = page;
                    return renderer.render(page, paper);
                }
            }
        };
        expect(await renderIssuedDocument(system, seeing, id)).toBe('rendered');
        const found = /data-qr="([^"]+)"/.exec(html)?.[1];
        if (!found) throw new Error('no QR on the page');
        const url = new URL(found.replaceAll('&amp;', '&'));
        const [payload = '', signature = ''] = url.hash.slice(1).split('.');
        return {
            url,
            token: url.pathname.slice(1),
            payload: Buffer.from(payload, 'base64url'),
            signature: Buffer.from(signature, 'base64url')
        };
    };
    /** As anyone: no token, no unit. */
    const ask = (token: string) =>
        api.http
            .getHttpAdapter()
            .getInstance()
            .inject({ method: 'GET', url: `/api/v1/public/verifications/${token}` });
    const publicKeyOf = async (keyId: string) => {
        const { rows } = await api.owner.query<{ public_key: string }>(
            'select public_key from documents.signing_keys where key_id = $1',
            [keyId]
        );
        return createPublicKey({
            key: { kty: 'OKP', crv: 'Ed25519', x: rows[0]?.public_key ?? '' },
            format: 'jwk'
        });
    };
    const receiptDocument = async () => {
        const { receiptId, number } = await receipted();
        await issueReceiptDocument(system, receiptSource(), receiptId);
        const [doc] = await docsOf(`subjectId=${receiptId}`);
        return { id: doc?.id ?? '', receiptId, number };
    };

    it('points at the public page, carries a signed payload, and its token is never stored', async () => {
        const { id, number } = await receiptDocument();
        const { url, token, payload, signature } = await rendered(id);
        expect(url.origin).toBe('https://verify.example.test');
        expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

        const facts = JSON.parse(payload.toString()) as { k: string; n: string; t: string; o: string; h: string };
        expect(facts).toMatchObject({ v: 1, t: 'receipt', n: number, o: 'WOL-BODITI' });
        expect(payload.toString()).not.toContain('Generated Applicant');
        expect(cryptoVerify(null, signedBytes(token, payload), await publicKeyOf(facts.k), signature)).toBe(true);
        // a changed payload fails, and so does another document's token: this is what an offline verifier checks
        const forged = Buffer.from(payload.toString().replace(number, 'WOL-BODITI/999999/2019'));
        expect(cryptoVerify(null, signedBytes(token, forged), await publicKeyOf(facts.k), signature)).toBe(false);
        const otherToken = randomBytes(16).toString('base64url');
        expect(cryptoVerify(null, signedBytes(otherToken, payload), await publicKeyOf(facts.k), signature)).toBe(false);

        const { rows } = await api.owner.query<{ hash: string }>(
            'select verification_token_hash as hash from documents.issued_documents where id = $1',
            [id]
        );
        expect(rows[0]?.hash).toBe(createHash('sha256').update(token).digest('hex'));
        expect(rows[0]?.hash).not.toContain(token);
    }, 120_000);

    it('resolves to valid for anyone, with a checker’s minimum and a masked name', async () => {
        const { id, number } = await receiptDocument();
        const { token } = await rendered(id);
        const got = await ask(token);
        expect(got.statusCode, got.body).toBe(200);
        expect(got.headers['cache-control']).toBe('no-store');
        expect(got.json()).toMatchObject({ status: 'valid', number, holder: 'G******** A********', validUntil: null });
        // its days are calendar days, not instants
        expect(got.json<{ issuedOn: string }>().issuedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(got.body).not.toContain('Generated');
        expect(got.body).not.toContain('Applicant');
    }, 120_000);

    it('answers the same 404 for a token that is not one, and one nobody holds', async () => {
        for (const token of ['short', 'not a token!', randomBytes(16).toString('base64url')]) {
            const got = await ask(encodeURIComponent(token));
            expect(got.statusCode, token).toBe(404);
        }
    });

    it('says revoked once its receipt is reversed', async () => {
        const { id, receiptId } = await receiptDocument();
        const { token } = await rendered(id);
        expect(await revokeReceiptDocument(system, receiptId)).toBe(true);
        expect((await ask(token)).json()).toMatchObject({ status: 'revoked' });
        // run again, it changes nothing; the stored PDF stays
        expect(await revokeReceiptDocument(system, receiptId)).toBe(true);
        expect((await rowOf(id))?.state).toBe('rendered');
        const list = await docsOf(`subjectId=${receiptId}`);
        expect(list[0]).toMatchObject({ revoked: true });
    }, 120_000);

    it('says revoked even when the reversal came before its document was made', async () => {
        const { receiptId } = await receipted();
        const asked = await api.call('POST', `/api/v1/receipts/${receiptId}/reversals`, as.boditiCashier, {
            reason: 'the applicant paid twice'
        });
        expect(asked.statusCode, asked.body).toBe(201);
        const decided = await api.call(
            'POST',
            `/api/v1/receipt-reversals/${asked.json<{ id: string }>().id}/decision`,
            as.zoneFinance,
            { decision: 'approved' }
        );
        expect(decided.statusCode, decided.body).toBe(200);
        // the reversal's event first: nothing to revoke yet
        expect(await revokeReceiptDocument(system, receiptId)).toBe(false);
        expect(await issueReceiptDocument(system, receiptSource(), receiptId)).toBe(true);
        const [doc] = await docsOf(`subjectId=${receiptId}`);
        expect(doc).toMatchObject({ revoked: true });
        const { token } = await rendered(doc?.id ?? '');
        expect((await ask(token)).json()).toMatchObject({ status: 'revoked' });
    }, 120_000);

    it('keeps its reason once revoked, and the revocation is on record', async () => {
        const { id, receiptId } = await receiptDocument();
        await revokeReceiptDocument(system, receiptId);
        await expect(
            api.owner.query(`update documents.issued_documents set revoke_reason = 'changed' where id = $1`, [id])
        ).rejects.toThrow(/keeps what was issued/);
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log
                  where table_name = 'documents.issued_documents' and row_id = $1 and action = 'update'
                    and diff::text like '%receipt_reversed%'`,
                [id]
            )
        ).toBe(1);
    });

    it('keeps no token for a template that prints no QR: nothing could ever scan it', async () => {
        const c = await filed(COPY);
        const [doc] = await docsOf(`caseId=${c.id}`);
        const version = (
            await api.owner.query<{ id: string; template_id: string; region_id: string; owner_unit_id: string }>(
                `select v.id, v.template_id, v.region_id, v.owner_unit_id from documents.document_template_versions v
                   join documents.issued_documents d on d.template_version_id = v.id where d.id = $1`,
                [doc?.id]
            )
        ).rows[0];
        const older = (
            await api.owner.query<{ id: string }>(
                `insert into documents.document_template_versions
                    (id, region_id, owner_unit_id, template_id, number, content_hash, body, strings, paper, data_schema)
                 values (gen_random_uuid(), $1, $2, $3, 99, 'no-qr', '<p>no code here</p>', '{}', 'A4', 'application-copy.v1')
                 returning id`,
                [version?.region_id, version?.owner_unit_id, version?.template_id]
            )
        ).rows[0]?.id;
        const inserted = (
            await api.owner.query<{ id: string }>(
                `insert into documents.issued_documents (id, region_id, handling_unit_id, template_id, template_version_id,
                     language, data, header, office_name)
                 select gen_random_uuid(), region_id, handling_unit_id, template_id, $1, language, data, header, office_name
                   from documents.issued_documents where id = $2 returning id`,
                [older, doc?.id]
            )
        ).rows[0]?.id;
        expect(await renderIssuedDocument(system, worker, inserted ?? '')).toBe('rendered');
        const { rows } = await api.owner.query<{ hash: string | null }>(
            'select verification_token_hash as hash from documents.issued_documents where id = $1',
            [inserted]
        );
        expect(rows[0]?.hash).toBeNull();
    }, 120_000);

    it('says superseded once a correction is issued, and the correction stands', async () => {
        const c = await filed(COPY);
        const [doc] = await docsOf(`caseId=${c.id}`);
        const oldId = doc?.id ?? '';
        const { token } = await rendered(oldId);
        const corrected = await api.installer.scoped({ requestId: 'system:test' }, (tx) =>
            api.http.get(DocumentsService).supersede(tx, oldId, {
                language: 'am',
                data: { caseNumber: 1, serviceName: 'Corrected', filedOn: '2026-11-04', fields: [] }
            })
        );
        // it is of the same record: the case lists it, and it is what a later revocation finds
        expect((await docsOf(`caseId=${c.id}`)).map((d) => d.id)).toContain(corrected.id);
        expect(
            await count(
                'select count(*)::int as n from documents.issued_documents where subject_id = $1 and superseded_by is null',
                [c.id]
            )
        ).toBe(1);
        // the old document names its correction on record, in the same transaction
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log
                  where table_name = 'documents.issued_documents' and row_id = $1 and action = 'update'
                    and diff::text like $2`,
                [oldId, `%${corrected.id}%`]
            )
        ).toBe(1);
        expect((await ask(token)).json()).toMatchObject({ status: 'superseded' });
        const fresh = await rendered(corrected.id);
        expect((await ask(fresh.token)).json()).toMatchObject({ status: 'valid' });
        // a correction of what no longer stands is refused
        await expect(
            api.installer.scoped({ requestId: 'system:test' }, (tx) =>
                api.http.get(DocumentsService).supersede(tx, oldId, {
                    language: 'am',
                    data: { caseNumber: 1, serviceName: 'Again', filedOn: '2026-11-04', fields: [] }
                })
            )
        ).rejects.toMatchObject({ code: 'invalid_transition' });
    }, 120_000);

    it('says expired once its validity has passed, and the card’s QR fits and carries it', async () => {
        const region = as.bureau.unit;
        const issued = await api.installer.scoped({ requestId: 'system:test' }, (tx) =>
            api.http.get(DocumentsService).issue(tx, {
                regionId: region.regionId,
                handlingUnitId: as.boditiRecords.unit.id,
                templateKey: 'licence-card',
                language: 'am',
                number: `SER-${randomInt(100_000, 999_999)}`,
                data: {
                    number: 'SER-1',
                    holderName: 'Generated Holder',
                    birthDate: null,
                    grades: [{ grade: 'B', name: t('Automobile') }],
                    issuedOn: '2020-01-01',
                    validUntil: '2024-01-01',
                    photo: null
                }
            })
        );
        const { token, payload } = await rendered(issued.id);
        const facts = JSON.parse(payload.toString()) as { u: string; h: string };
        expect(facts.u).toBe('2024-01-01');
        expect(facts.h).toBe('G******** H*****');
        expect((await ask(token)).json()).toMatchObject({ status: 'expired', holder: 'G******** H*****' });
    }, 120_000);

    it('passes the verifier’s own check with the keys the API publishes, and fails it when tampered with', async () => {
        const { id } = await receiptDocument();
        const { url, token, signature } = await rendered(id);
        const published = await api.http
            .getHttpAdapter()
            .getInstance()
            .inject({ method: 'GET', url: '/api/v1/public/verification-keys' });
        expect(published.statusCode, published.body).toBe(200);
        expect(published.headers['cache-control']).toBe('no-store');
        const { keys, documents } = published.json<{
            keys: PublishedKey[];
            documents: { key: string; name: { am: string; en: string } }[];
        }>();
        // a phone in flight mode can say what kind of document a QR's key means
        expect(documents.find((d) => d.key === 'receipt')?.name.en).toBeTruthy();
        // public halves and when they retired: nothing else leaves
        for (const key of keys) expect(Object.keys(key).sort()).toEqual(['keyId', 'publicKey', 'retiredOn']);
        expect(published.body).not.toContain('private');

        const today = addisToday();
        const check = await checkQr(url.href, keys, today);
        if (check.state !== 'genuine') throw new Error(`not genuine: ${check.state}`);
        // the signature's days and name are the ones the API tells of the token
        const live = (await ask(token)).json<{
            number: string;
            issuedOn: string;
            validUntil: string;
            holder: string;
        }>();
        expect([check.facts.n, check.facts.i, check.facts.u, check.facts.h]).toEqual([
            live.number,
            live.issuedOn,
            live.validUntil,
            live.holder
        ]);

        const swapped = url.href.replace(token, randomBytes(16).toString('base64url'));
        expect(await checkQr(swapped, keys, today)).toMatchObject({ state: 'forged' });

        const changed = encodeBase64Url(payloadBytes({ ...check.facts, n: 'FORGED-1' }));
        const tampered = `${url.origin}/${token}#${changed}.${signature.toString('base64url')}`;
        expect(await checkQr(tampered, keys, today)).toEqual({ state: 'forged', token });
    }, 120_000);

    it('signs with a key the app can’t read, rotates it yearly, and an old key still verifies', async () => {
        const { id } = await receiptDocument();
        const { url, token, payload, signature } = await rendered(id);
        const facts = JSON.parse(payload.toString()) as VerificationPayload;
        const signedBy = facts.k;
        const region = as.bureau.unit.regionId;
        const old = await currentSigningKey(system, worker.crypto, region);
        expect(old.keyId).toBe(signedBy);
        // a year on: a new key takes over, and what the old one signed still checks out
        const rotatedAt = new Date(Date.now() + 400 * 86_400_000);
        const next = await currentSigningKey(system, worker.crypto, region, rotatedAt);
        expect(next.keyId).not.toBe(signedBy);

        // the verifier sees both keys, and holds a retired one to what it signed before it retired
        const published = await api.http
            .getHttpAdapter()
            .getInstance()
            .inject({ method: 'GET', url: '/api/v1/public/verification-keys' });
        const { keys } = published.json<{ keys: PublishedKey[] }>();
        const retiredOn = addisToday(rotatedAt);
        expect(keys.find((k) => k.keyId === signedBy)?.retiredOn).toBe(retiredOn);
        expect(keys.find((k) => k.keyId === next.keyId)?.retiredOn).toBeNull();
        expect(await checkQr(url.href, keys, addisToday())).toMatchObject({ state: 'genuine', token });
        const late = payloadBytes({ ...facts, i: addisToday(new Date(rotatedAt.getTime() + 86_400_000)) });
        expect(
            await checkQr(
                verificationUrl(url.origin, token, late, signPayload(old, signedBytes(token, late))),
                keys,
                addisToday()
            )
        ).toEqual({ state: 'forged', token });
        const { rows } = await api.owner.query<{ active: boolean }>(
            'select active from documents.signing_keys where key_id = $1',
            [signedBy]
        );
        expect(rows[0]?.active).toBe(false);
        expect(cryptoVerify(null, signedBytes(token, payload), await publicKeyOf(signedBy), signature)).toBe(true);
        // it stays a key's own: nothing changes but its retirement, and it is never deleted
        await expect(
            api.owner.query(`update documents.signing_keys set public_key = 'x' where key_id = $1`, [signedBy])
        ).rejects.toThrow(/only retire/);
        await expect(
            api.owner.query('delete from documents.signing_keys where key_id = $1', [signedBy])
        ).rejects.toThrow(/only retire/);

        // on record, and its private half never in the log
        const logged = await api.owner.query<{ diff: unknown }>(
            `select diff from kernel.audit_log where table_name = 'documents.signing_keys'`
        );
        expect(logged.rows.length).toBeGreaterThanOrEqual(2);
        expect(JSON.stringify(logged.rows)).not.toContain('privateKey');
        expect(JSON.stringify(logged.rows)).not.toContain('private_key');

        // the app's role reads the public half only
        const app = new Client({ connectionString: pg.url('app') });
        await app.connect();
        try {
            await expect(app.query('select private_key from documents.signing_keys')).rejects.toThrow(
                /permission denied/
            );
        } finally {
            await app.end();
        }
    }, 120_000);
});
