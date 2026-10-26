/**
 * Registry lookups and file answers (task 0.18), over HTTP on a real PostgreSQL 16 and the dev stack's SeaweedFS: a form
 * field of type RegistryLookup stores only the id of a person or an organisation of the caller's region; the server
 * refuses an id of another region, an unknown one and a merged person, in a row too. A file answer names a file the
 * caller's office uploaded, of the document type the field asks for; the submission links it, and keeps the stored name
 * and size, never the browser's. Names and numbers are generated (never a real person's). Needs: pnpm dev:infra.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { S3ObjectStore } from '@itrms/integrations/api';
import type { OrgUnit } from '@itrms/kernel/org';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const envFile = join(HERE, '..', '..', '..', '..', 'infra', 'compose', '.env');
if (!process.env.S3_ACCESS_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
const S3 = {
    endpoint: process.env.S3_ENDPOINT ?? `http://127.0.0.1:${process.env.S3_HOST_PORT ?? '18333'}`,
    bucket: process.env.S3_BUCKET ?? 'itrms-test',
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? ''
};

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000f501',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    damot: '0199f0a0-d000-7000-8000-000000000202',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    boditi: '0199f0a0-d000-7000-8000-000000000302',
    tzbHead: '0199f0a0-d000-7000-8000-00000000f502',
    trx: '0199f0a0-d000-7000-8000-00000000f503'
};

let pg: TestPostgres;
let api: TestApi;
let store: S3ObjectStore;
const units = {} as Record<'ser' | 'zone' | 'damot' | 'boditi' | 'tzb' | 'trx', OrgUnit>;
const as = {
    bureau: (): As => ({ sub: SUB.bureau, unit: units.ser }),
    bureau2: (): As => ({ sub: SUB.bureau2, unit: units.ser }),
    zoneHead: (): As => ({ sub: SUB.zoneHead, unit: units.zone }),
    damot: (): As => ({ sub: SUB.damot, unit: units.damot }),
    damotHead: (): As => ({ sub: SUB.damotHead, unit: units.damot }),
    boditi: (): As => ({ sub: SUB.boditi, unit: units.boditi }),
    tzb: (): As => ({ sub: SUB.tzbHead, unit: units.tzb }),
    trx: (): As => ({ sub: SUB.trx, unit: units.trx }),
    // a real user, but with no role in this unit
    damotWithoutRole: (): As => ({ sub: SUB.boditi, unit: units.damot })
};

interface Problem {
    code: string;
    errors: { path: string; code: string; message: string }[];
}
interface Item {
    id: string;
    label: string;
    active: boolean;
    facts: { key: string; label: string; value: string | null }[];
}
interface PersonOut {
    id: string;
}

const AM_INVALID_REFERENCE = 'ይህ መዝገብ አልተገኘም ወይም ከእንግዲህ ሊመረጥ አይችልም';

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    props: {},
    ...extra
});

/** A fictitious person with a name that tells the cases apart, and sensitive fields that must never come out. */
function person(n: number, given: string, father: string, sensitive = false) {
    return {
        nameAm: { given, father },
        // Latin names are letters only: the suffix tells the cases apart
        nameEn: { given: 'Hanna', father: `Lookup${'ABCDEFGH'[n]}` },
        sex: 'female',
        birthYear: 1990 + n,
        ...(sensitive
            ? {
                  sensitive: {
                      birthDate: `${1990 + n}-03-14`,
                      phone: `0911 ${String(300000 + n).slice(-6)}`,
                      fin: String(500000000000 + n)
                  }
              }
            : {})
    };
}

async function register(who: As, body: object): Promise<string> {
    const res = await api.call('POST', '/api/v1/persons', who, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<PersonOut>().id;
}

async function organisation(who: As, body: object): Promise<string> {
    const res = await api.call('POST', '/api/v1/organisations', who, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<PersonOut>().id;
}

async function createAndPublish(key: string, fields: unknown[]): Promise<{ id: string; versionId: string }> {
    const created = await api.call('POST', '/api/v1/forms', as.bureau(), {
        key,
        name: { am: `ቅጽ ${key}`, en: `Form ${key}` },
        document: { fields }
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    const asked = (await api.call('POST', `/api/v1/forms/${id}/publications`, as.bureau(), {})).json<{
        id: string;
        version: number;
        formVersion: { id: string };
    }>();
    const approved = await api.call(
        'POST',
        `/api/v1/form-publications/${asked.id}/approval`,
        as.bureau2(),
        {},
        { 'if-match': `"${asked.version}"` }
    );
    expect(approved.statusCode, approved.body).toBe(200);
    return { id, versionId: asked.formVersion.id };
}

const submit = (
    who: As,
    form: { id: string; versionId: string },
    answers: Record<string, unknown>,
    headers: Record<string, string> = {}
) => api.call('POST', '/api/v1/submissions', who, { formId: form.id, formVersionId: form.versionId, answers }, headers);

const search = (who: As, provider: string, q: string, headers: Record<string, string> = {}) =>
    api.call('GET', `/api/v1/registry-lookups/${provider}?q=${encodeURIComponent(q)}`, who, undefined, headers);
const found = async (who: As, provider: string, q: string) =>
    (await search(who, provider, q)).json<{ items: Item[] }>().items.map((i) => i.id);

/** A PDF-looking file: the PDF signature, then random bytes. */
const pdf = (size: number) => {
    const bytes = randomBytes(size);
    Buffer.from('%PDF-1.7\n').copy(bytes);
    return bytes;
};

/** Uploads and confirms a file as `who` the way the browser does: a presigned POST, then the confirmation. */
async function uploaded(who: As, documentType: string | undefined, size = 2048): Promise<string> {
    const bytes = pdf(size);
    const begun = await api.call('POST', '/api/v1/files', who, {
        filename: 'ሰነድ.pdf',
        contentType: 'application/pdf',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(documentType ? { documentType } : {})
    });
    expect(begun.statusCode, begun.body).toBe(201);
    const ticket = begun.json<{
        file: { id: string };
        upload: { kind: string; url: string; fields: Record<string, string> };
    }>();
    const form = new FormData();
    for (const [k, v] of Object.entries(ticket.upload.fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    expect((await fetch(ticket.upload.url, { method: 'POST', body: form })).status).toBe(204);
    const confirmed = await api.call('POST', `/api/v1/files/${ticket.file.id}/confirm`, who, {});
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return ticket.file.id;
}

const ids = {
    person: '',
    sameZone: '',
    third: '',
    otherRegion: '',
    merged: '',
    organisation: '',
    otherRegionOrganisation: ''
};
let form = { id: '', versionId: '' };

beforeAll(async () => {
    if (!S3.accessKeyId || !S3.secretAccessKey) throw new Error('S3 credentials missing: run pnpm dev:infra first');
    pg = await startPostgres();
    store = new S3ObjectStore({ ...S3 });
    api = await startApi(
        pg,
        [
            {
                username: 'test.bureau.admin2',
                sub: SUB.bureau2,
                region: 'SER',
                home: 'SER',
                roles: [['SER', 'bureau_admin']]
            },
            { username: 'test.tzb.head', sub: SUB.tzbHead, region: 'SER', home: 'TZB', roles: [['TZB', 'unit_head']] },
            {
                username: 'test.trx.records',
                sub: SUB.trx,
                region: 'TRX',
                home: 'TRX-W1',
                roles: [['TRX-W1', 'records_officer']]
            }
        ],
        { objectStore: store }
    );
    units.ser = await api.unit('SER', 'SER');
    units.zone = await api.unit('SER', 'WOL');
    units.damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    units.boditi = await api.unit('SER', 'WOL-BODITI');
    units.tzb = await api.unit('SER', 'TZB');
    units.trx = await api.unit('TRX', 'TRX-W1');

    ids.person = await register(as.damot(), person(1, 'ሐና', 'ለቀምቶ', true));
    // the three share a name: the duplicate check needs a FIN, phone or birth date too, which the last two have none of
    ids.sameZone = await register(as.boditi(), person(2, 'ሐና', 'ለቀምቶ'));
    ids.third = await register(as.damot(), person(3, 'ሐና', 'ለቀምቶ'));
    ids.otherRegion = await register(as.trx(), person(4, 'ሐና', 'ለቀምቶ'));
    ids.organisation = await organisation(as.damot(), {
        kind: 'association',
        name: { am: 'የሙከራ ማህበር ለቀምቶ', en: 'Lookup Test Association' },
        tin: '1000000001',
        licenceNumber: 'LTA-001'
    });
    ids.otherRegionOrganisation = await organisation(as.trx(), {
        kind: 'association',
        name: { am: 'የሌላ ክልል ማህበር ለቀምቶ', en: 'Lookup Test Association Elsewhere' },
        tin: '1000000002'
    });

    // a person registered, then merged into another: the record kept stays pickable, the closed one does not
    const survivor = await register(as.damot(), person(5, 'ዳዊት', 'ማዳሞ'));
    ids.merged = await register(as.damot(), person(6, 'ዳዊት', 'ማዳሞ'));
    const asked = await api.call('POST', '/api/v1/person-merges', as.damot(), {
        survivorId: survivor,
        duplicateId: ids.merged,
        reason: 'registered twice at the same counter'
    });
    expect(asked.statusCode, asked.body).toBe(201);
    const merge = asked.json<{ id: string; version: number }>();
    const approved = await api.call(
        'POST',
        `/api/v1/person-merges/${merge.id}/approval`,
        as.damotHead(),
        {},
        { 'if-match': `"${merge.version}"` }
    );
    expect(approved.statusCode, approved.body).toBe(200);

    form = await createAndPublish('lookups', [
        field('applicant', 'RegistryLookup', { props: { provider: 'person' } }),
        field('club', 'RegistryLookup', { props: { provider: 'organisation' } }),
        field('members', 'FormArray', { category: 'Layout', layout: { options: { isContainer: true } } }),
        field('who', 'RegistryLookup', { props: { provider: 'person' }, parentId: 'members' })
    ]);
}, 300_000);

afterAll(async () => {
    store?.destroy();
    await api?.close();
    await pg?.stop();
});

describe('the registries a form can point to', () => {
    it('are listed with their titles and the facts they show, in Amharic', async () => {
        const res = await api.call('GET', '/api/v1/registry-lookups', as.damot(), undefined, {
            'accept-language': 'am'
        });
        expect(res.statusCode, res.body).toBe(200);
        const { items } = res.json<{
            items: { key: string; title: string; facts: { key: string; label: string }[] }[];
        }>();
        expect(items.map((i) => i.key).sort()).toEqual(['organisation', 'person']);
        expect(items.find((i) => i.key === 'person')?.title).toBe('ሰው (ከመዝገብ)');
        expect(items.find((i) => i.key === 'organisation')?.title).toBe('ድርጅት (ከመዝገብ)');
        expect(items.find((i) => i.key === 'person')?.facts.map((f) => f.key)).toEqual([
            'nameAm',
            'nameEn',
            'sex',
            'birthYear',
            'handlingUnit'
        ]);
    });

    it('answer 404 for a registry that is not installed, and 403 to a user with no role in the unit', async () => {
        expect((await search(as.damot(), 'vehicle', 'ab')).statusCode).toBe(404);
        expect((await search(as.damotWithoutRole(), 'person', 'ሐና')).statusCode).toBe(403);
    });
});

describe('a person search', () => {
    it('finds a person from the same zone, from Test Zone B (same region) and by either script, active ones only', async () => {
        for (const who of [as.damot(), as.boditi(), as.tzb()]) {
            const list = await found(who, 'person', 'ሐና ለቀምቶ');
            expect(list).toEqual(expect.arrayContaining([ids.person, ids.sameZone, ids.third]));
            expect(list).not.toContain(ids.otherRegion);
        }
        expect(await found(as.damot(), 'person', 'hanna lookupb')).toContain(ids.person);
        // a merged record is not offered
        expect(await found(as.damot(), 'person', 'ዳዊት ማዳሞ')).not.toContain(ids.merged);
    });

    it('does not find a person of another region (and Test Region X finds only its own)', async () => {
        expect(await found(as.trx(), 'person', 'ሐና ለቀምቶ')).toEqual([ids.otherRegion]);
    });

    it('shows names, sex, birth year and office, and never a FIN, phone or birth date', async () => {
        const res = await search(as.boditi(), 'person', 'ሐና ለቀምቶ', { 'accept-language': 'en' });
        const item = res.json<{ items: Item[] }>().items.find((i) => i.id === ids.person);
        expect(item).toMatchObject({ active: true });
        expect(Object.fromEntries((item?.facts ?? []).map((f) => [f.key, f.value]))).toEqual({
            nameAm: 'ሐና ለቀምቶ',
            nameEn: 'Hanna LookupB',
            sex: 'Female',
            birthYear: '1991',
            handlingUnit: 'Damot Gale'
        });
        const text = res.body;
        for (const secret of ['500000000001', '251911300001', '1991-03-14']) expect(text).not.toContain(secret);
    });

    it('is read back by id for a saved value, merged records included', async () => {
        const res = await api.call(
            'GET',
            `/api/v1/registry-lookups/person/items?ids=${ids.person},${ids.merged},${ids.otherRegion}`,
            as.damot()
        );
        expect(res.statusCode, res.body).toBe(200);
        const list = res.json<{ items: Item[] }>().items;
        expect(list.map((i) => [i.id, i.active]).sort()).toEqual(
            [
                [ids.person, true],
                [ids.merged, false]
            ].sort()
        );
    });
});

describe('an organisation search', () => {
    it('finds an organisation by name or TIN from the region, with its kind, TIN, licence and office', async () => {
        for (const who of [as.damot(), as.boditi(), as.tzb()]) {
            const byName = await search(who, 'organisation', 'Lookup Test Association');
            const item = byName.json<{ items: Item[] }>().items.find((i) => i.id === ids.organisation);
            expect(item?.label).toBe('Lookup Test Association');
            expect(Object.fromEntries((item?.facts ?? []).map((f) => [f.key, f.value]))).toEqual({
                kind: 'Association',
                tin: '1000000001',
                licenceNumber: 'LTA-001',
                handlingUnit: 'Damot Gale'
            });
            expect(await found(who, 'organisation', '1000000001')).toEqual([ids.organisation]);
        }
        expect(await found(as.trx(), 'organisation', 'Lookup Test Association')).not.toContain(ids.organisation);
    });
});

describe('a submission with registry answers', () => {
    it('stores only the id of the person picked and audits the write', async () => {
        const res = await submit(as.damot(), form, { applicant: ids.person, club: ids.organisation });
        expect(res.statusCode, res.body).toBe(201);
        const created = res.json<{ id: string; answers: Record<string, unknown> }>();
        expect(created.answers).toEqual({ applicant: ids.person, club: ids.organisation });
        const stored = await api.owner.query<{ answers: Record<string, unknown> }>(
            'select answers from forms.submissions where id = $1',
            [created.id]
        );
        expect(stored.rows[0]?.answers).toEqual({ applicant: ids.person, club: ids.organisation });
        const audit = await api.owner.query<{ action: string }>(
            "select action from kernel.audit_log where table_name = 'forms.submissions' and row_id = $1",
            [created.id]
        );
        expect(audit.rows.map((r) => r.action)).toEqual(['insert']);
    });

    it('accepts a person of another office of the region, and one in a repeated row', async () => {
        const res = await submit(as.damot(), form, {
            applicant: ids.sameZone,
            members: [{ who: ids.third }, { who: ids.person }]
        });
        expect(res.statusCode, res.body).toBe(201);
    });

    it('refuses a forged id of another region, with the Amharic message, and stores nothing', async () => {
        const before = await api.owner.query<{ n: number }>('select count(*)::int as n from forms.submissions');
        const res = await submit(as.damot(), form, { applicant: ids.otherRegion }, { 'accept-language': 'am' });
        expect(res.statusCode, res.body).toBe(422);
        expect(res.json<Problem>().errors).toEqual([
            { path: 'applicant', code: 'invalid_reference', message: AM_INVALID_REFERENCE }
        ]);
        const after = await api.owner.query<{ n: number }>('select count(*)::int as n from forms.submissions');
        expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });

    it('refuses an id nobody has, a closed (merged) person and a malformed id', async () => {
        for (const applicant of [randomUUID(), ids.merged]) {
            const res = await submit(as.damot(), form, { applicant });
            expect(res.statusCode, res.body).toBe(422);
            expect(res.json<Problem>().errors).toMatchObject([{ path: 'applicant', code: 'invalid_reference' }]);
        }
        const malformed = await submit(as.damot(), form, { applicant: 'not-an-id' });
        expect(malformed.statusCode, malformed.body).toBe(422);
    });

    it('refuses an organisation of another region, and a person given where an organisation is asked', async () => {
        for (const club of [ids.otherRegionOrganisation, ids.person]) {
            const res = await submit(as.damot(), form, { club });
            expect(res.statusCode, res.body).toBe(422);
            expect(res.json<Problem>().errors).toMatchObject([{ path: 'club', code: 'invalid_reference' }]);
        }
    });

    it('names the row of a repeatable group that holds the refused id', async () => {
        const res = await submit(as.damot(), form, {
            members: [{ who: ids.person }, { who: ids.otherRegion }]
        });
        expect(res.statusCode, res.body).toBe(422);
        expect(res.json<Problem>().errors).toMatchObject([{ path: 'members[1].who', code: 'invalid_reference' }]);
        const first = await submit(as.damot(), form, { members: [{ who: randomUUID() }] });
        expect(first.json<Problem>().errors).toMatchObject([{ path: 'members[0].who', code: 'invalid_reference' }]);
    });
});

describe('a form that names a registry', () => {
    it('is refused on save when the registry is not installed (invalid_form, at the field)', async () => {
        const res = await api.call('POST', '/api/v1/forms', as.bureau(), {
            key: 'bad-lookup',
            name: { am: 'የተበላሸ', en: 'Bad' },
            document: { fields: [field('v', 'RegistryLookup', { props: { provider: 'vehicle' } })] }
        });
        expect(res.statusCode, res.body).toBe(422);
        expect(res.json<Problem>().code).toBe('invalid_form');
        expect(res.json<Problem>().errors[0]).toMatchObject({ path: 'document.fields[0].props.provider' });
    });

    it('is refused on save when a lookup names no registry at all', async () => {
        const res = await api.call('POST', '/api/v1/forms', as.bureau(), {
            key: 'no-lookup',
            name: { am: 'ያለ መዝገብ', en: 'None' },
            document: { fields: [field('v', 'RegistryLookup')] }
        });
        expect(res.statusCode, res.body).toBe(422);
    });
});

describe('a file answer', () => {
    let files: { id: string; versionId: string };

    beforeAll(async () => {
        files = await createAndPublish('medical', [
            field('certificate', 'FileUpload', { props: { docType: 'medical_certificate' } }),
            field('anything', 'FileUpload')
        ]);
    });

    it('stores the file with its document type, links it to the submission and audits both', async () => {
        const fileId = await uploaded(as.damot(), 'medical_certificate');
        const audited = await api.owner.query<{ n: number }>(
            "select count(*)::int as n from kernel.audit_log where table_name = 'kernel.files' and row_id = $1",
            [fileId]
        );
        const res = await submit(as.damot(), files, { certificate: [{ file_id: fileId }] });
        expect(res.statusCode, res.body).toBe(201);
        const created = res.json<{ id: string; answers: { certificate: Record<string, unknown>[] } }>();
        expect(created.answers.certificate).toEqual([
            {
                file_id: fileId,
                name: 'ሰነድ.pdf',
                size: 2048,
                type: 'application/pdf',
                documentType: 'medical_certificate'
            }
        ]);
        const row = await api.owner.query<{
            document_type: string;
            linked_table: string;
            linked_id: string;
            expires_at: Date | null;
        }>('select document_type, linked_table, linked_id, expires_at from kernel.files where id = $1', [fileId]);
        expect(row.rows[0]).toEqual({
            document_type: 'medical_certificate',
            linked_table: 'forms.submissions',
            linked_id: created.id,
            expires_at: null
        });
        const after = await api.owner.query<{ n: number }>(
            "select count(*)::int as n from kernel.audit_log where table_name = 'kernel.files' and row_id = $1",
            [fileId]
        );
        expect(after.rows[0]?.n).toBeGreaterThan(audited.rows[0]?.n ?? 0);
    });

    it('keeps the stored name and size, not the ones the browser declares', async () => {
        const fileId = await uploaded(as.damot(), undefined, 3000);
        const res = await submit(as.damot(), files, {
            anything: [{ file_id: fileId, name: 'forged.exe', size: 1, type: 'text/html' }]
        });
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json<{ answers: { anything: unknown[] } }>().answers.anything).toEqual([
            { file_id: fileId, name: 'ሰነድ.pdf', size: 3000, type: 'application/pdf' }
        ]);
    });

    it('is refused when the file is of another document type, another office, unknown, used already or no file at all', async () => {
        const wrongType = await uploaded(as.damot(), 'id_card');
        const elsewhere = await uploaded(as.boditi(), 'medical_certificate');
        const used = await uploaded(as.damot(), 'medical_certificate');
        expect((await submit(as.damot(), files, { certificate: [{ file_id: used }] })).statusCode).toBe(201);
        const cases: [string, unknown][] = [
            ['another document type', wrongType],
            ['another office', elsewhere],
            ['unknown', randomUUID()],
            ['already used', used],
            ['malformed', 'x']
        ];
        for (const [name, file_id] of cases) {
            const res = await submit(as.damot(), files, { certificate: [{ file_id }] });
            expect(res.statusCode, `${name}: ${res.body}`).toBe(422);
            expect(res.json<Problem>().errors, name).toMatchObject([{ path: 'certificate', code: 'invalid_file' }]);
        }
        // a name and a size without a stored file
        const bare = await submit(as.damot(), files, { anything: [{ name: 'a.pdf', size: 10 }] });
        expect(bare.statusCode, bare.body).toBe(422);
        expect(bare.json<Problem>().errors).toMatchObject([{ path: 'anything', code: 'invalid_file' }]);
        // a refused submission leaves the file free
        const free = await api.owner.query<{ linked_id: string | null }>(
            'select linked_id from kernel.files where id = $1',
            [wrongType]
        );
        expect(free.rows[0]?.linked_id).toBeNull();
    });

    it('is refused at the upload when the document type is not one the system knows', async () => {
        const bytes = pdf(512);
        const res = await api.call('POST', '/api/v1/files', as.damot(), {
            filename: 'a.pdf',
            contentType: 'application/pdf',
            size: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            documentType: 'secret_plans'
        });
        expect(res.statusCode, res.body).toBe(422);
    });
});
