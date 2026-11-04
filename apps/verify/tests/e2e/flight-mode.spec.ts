/**
 * The verifier in a real browser, on the built app, under its own CSP (ADR-0046, task 0.23c). The server goes away as well as the
 * browser going offline, so nothing here can quietly reach a network. The camera is Chromium's fake one, showing a real QR.
 */
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';
import QRCode from 'qrcode';

import { serve } from './server';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const base64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

const newKey = (keyId: string, retiredOn: string | null = null) => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
        privateKey,
        published: {
            keyId,
            publicKey: base64Url(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
            retiredOn
        }
    };
};
const ACTIVE = newKey('active');
const RETIRED = newKey('retired', '2026-06-30');
const STRANGER = newKey('stranger');

const FACTS = {
    v: 1,
    k: 'active',
    t: 'licence-card',
    n: 'SER-100',
    o: 'BOD',
    i: '2026-10-01',
    u: '2099-10-01',
    h: 'G******** H*****'
};
const TOKEN = randomBytes(16).toString('base64url');

const qrOf = (facts: Record<string, unknown>, key = ACTIVE, token = TOKEN) => {
    const bytes = Buffer.from(JSON.stringify(facts));
    return `https://verify.example.test/${token}#${base64Url(bytes)}.${base64Url(sign(null, bytes, key.privateKey))}`;
};

/** The QR as Chromium's fake camera shows it: one 4:2:0 frame, repeated. */
function cameraFile(text: string): string {
    const code = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
    const size = 720;
    const cell = Math.floor(size / (code.size + 8));
    const from = Math.floor((size - cell * code.size) / 2);
    const luma = Buffer.alloc(size * size, 255);
    for (let y = 0; y < code.size * cell; y += 1)
        for (let x = 0; x < code.size * cell; x += 1)
            if (code.get(Math.floor(y / cell), Math.floor(x / cell))) luma[(from + y) * size + from + x] = 0;
    const chroma = Buffer.alloc((size * size) / 2, 128);
    const file = join(mkdtempSync(join(tmpdir(), 'itrms-camera-')), 'qr.y4m');
    writeFileSync(
        file,
        Buffer.concat([Buffer.from(`YUV4MPEG2 W${size} H${size} F10:1 Ip A1:1 C420\nFRAME\n`), luma, chroma])
    );
    return file;
}

test.use({
    launchOptions: {
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${cameraFile(qrOf(FACTS))}`
        ]
    }
});

const showQr = async (page: Page, text: string) => {
    const buffer = await QRCode.toBuffer(text, { errorCorrectionLevel: 'M', margin: 4, scale: 6 });
    await page.locator('[data-photo]').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer });
};
const verdict = (page: Page, kind: string) => expect(page.locator(`[data-verdict="${kind}"]`)).toBeVisible();

const watchPolicy = (page: Page) => {
    const refused: string[] = [];
    page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) refused.push(message.text());
    });
    return refused;
};

const makeReady = async (page: Page, origin: string) => {
    await page.goto(`${origin}/scan`);
    await expect(page.locator('[data-keys="ready"]')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
};

test.describe('the verifier', () => {
    let server: Awaited<ReturnType<typeof serve>>;
    let status: unknown;

    test.beforeAll(async () => {
        server = await serve(OUT, {
            keys: () => ({ keys: [ACTIVE.published, RETIRED.published] }),
            verification: (token) => (token === TOKEN ? status : null)
        });
    });
    test.afterAll(async () => {
        await server?.close();
    });
    test.beforeEach(() => {
        server.comeBack();
        status = {
            status: 'valid',
            documentName: { am: 'ካርድ', en: 'Card' },
            number: FACTS.n,
            office: { am: 'ጽ/ቤት', en: 'Office' },
            issuedOn: FACTS.i,
            validUntil: FACTS.u,
            holder: FACTS.h
        };
    });

    test('validates a QR in flight mode and rejects a tampered one', async ({ page, context }) => {
        const refused = watchPolicy(page);
        await makeReady(page, server.origin);

        server.goAway();
        await context.setOffline(true);
        await page.reload();
        await expect(page.locator('[data-keys="ready"]')).toBeVisible();

        await showQr(page, qrOf(FACTS));
        await verdict(page, 'offlineGood');
        await expect(page.getByText('SER-100')).toBeVisible();

        const [address = '', proof = ''] = qrOf(FACTS).split('#');
        const changed = base64Url(Buffer.from(JSON.stringify({ ...FACTS, n: 'SER-999' })));
        await showQr(page, `${address}#${changed}.${proof.split('.')[1]}`);
        await verdict(page, 'forged');

        await showQr(page, qrOf({ ...FACTS, k: 'retired', i: '2026-06-01' }, RETIRED));
        await verdict(page, 'offlineGood');
        await showQr(page, qrOf({ ...FACTS, k: 'retired', i: '2026-07-01' }, RETIRED));
        await verdict(page, 'forged');

        await showQr(page, qrOf({ ...FACTS, k: 'stranger' }, STRANGER));
        await verdict(page, 'unknownKey');
        await showQr(page, qrOf({ ...FACTS, u: '2020-01-01' }));
        await verdict(page, 'offlineExpired');
        await showQr(page, 'https://example.test/not-a-document');
        await verdict(page, 'notOurs');

        expect(refused).toEqual([]);
    });

    test('opens a document’s own address in flight mode, and proves it there', async ({ page, context }) => {
        const refused = watchPolicy(page);
        await makeReady(page, server.origin);
        server.goAway();
        await context.setOffline(true);

        const address = (text: string) => server.origin + text.slice('https://verify.example.test'.length);
        await page.goto(address(qrOf(FACTS)));
        await verdict(page, 'offlineGood');

        await page.goto('about:blank');
        const [good = '', proof = ''] = qrOf(FACTS).split('#');
        const changed = base64Url(Buffer.from(JSON.stringify({ ...FACTS, u: '2199-01-01' })));
        await page.goto(address(`${good}#${changed}.${proof.split('.')[1]}`));
        await verdict(page, 'forged');
        expect(refused).toEqual([]);
    });

    test('takes the live status when there is a connection, and catches a swapped token', async ({ page }) => {
        await makeReady(page, server.origin);

        await showQr(page, qrOf(FACTS));
        await verdict(page, 'valid');

        status = { ...(status as object), status: 'revoked' };
        await showQr(page, qrOf(FACTS));
        await verdict(page, 'revoked');

        // a revoked document's facts beside a token of no document: the status can't be cut off that way
        await showQr(page, qrOf(FACTS, ACTIVE, randomBytes(16).toString('base64url')));
        await verdict(page, 'forged');

        // a real token beside another's facts
        await showQr(page, qrOf({ ...FACTS, n: 'SER-200' }));
        await verdict(page, 'forged');
    });

    test('reads a QR from the camera, in flight mode', async ({ page, context }) => {
        const refused = watchPolicy(page);
        await makeReady(page, server.origin);
        server.goAway();
        await context.setOffline(true);
        await page.reload();

        await page.locator('[data-scan]').click();
        await verdict(page, 'offlineGood');
        // the camera is closed once it has read a code
        await expect(page.locator('[data-camera]')).toHaveCount(0);
        expect(refused).toEqual([]);
    });
});
