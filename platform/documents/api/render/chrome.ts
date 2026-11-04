/**
 * HTML to PDF in headless Chrome (ADR-0006, ADR-0031 §10). Only the `worker-documents` process loads this: the API and the
 * main worker never launch Chrome (dependency-cruiser: only-the-pdf-worker-reaches-chrome). A page runs with JavaScript off and
 * every request refused but its own inline data, and at most `pages` run at once. A browser that crashed, or could not start,
 * is forgotten so the next render starts another; one that has rendered enough is retired once its pages are done, so its
 * memory never grows without end.
 */
import { existsSync } from 'node:fs';

import puppeteer, { type Browser } from 'puppeteer-core';

import type { Paper } from '../../contracts';
import { PAGE } from './html';

const CANDIDATES = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

/** Chrome: `CHROME_PATH`, or where systems install it. */
export function findChrome(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
    if (env.CHROME_PATH) return env.CHROME_PATH;
    return CANDIDATES.find((path) => existsSync(path));
}

export interface PdfRendererOptions {
    executablePath: string;
    /** where the OS can't give Chrome its sandbox (a CI runner). The content is escaped and offline either way */
    noSandbox?: boolean;
    pages?: number;
    timeoutMs?: number;
    recycleAfter?: number;
    /** each refused request, for a test or the log */
    onBlocked?: (url: string) => void;
}

/** A browser, and how far it has got. */
interface Slot {
    browser: Promise<Browser>;
    active: number;
    rendered: number;
    retired: boolean;
}

export class PdfRenderer {
    private current: Slot | undefined;
    private running = 0;
    private readonly waiting: (() => void)[] = [];

    constructor(private readonly options: PdfRendererOptions) {}

    private launch(): Slot {
        const slot: Slot = {
            active: 0,
            rendered: 0,
            retired: false,
            browser: puppeteer.launch({
                executablePath: this.options.executablePath,
                headless: true,
                // a busy machine can take a while to start a browser: slow is not broken
                timeout: 90_000,
                args: [
                    ...(this.options.noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--no-first-run',
                    '--no-default-browser-check',
                    // nothing resolves, whatever a page might ask
                    '--host-resolver-rules=MAP * ~NOTFOUND',
                    '--js-flags=--max-old-space-size=256'
                ]
            })
        };
        const forget = () => {
            if (this.current === slot) this.current = undefined;
        };
        // a browser that could not start, or that died (out of memory, killed), is not used again
        slot.browser.then((browser) => browser.once('disconnected', forget)).catch(forget);
        return slot;
    }

    private async acquire(): Promise<void> {
        const limit = this.options.pages ?? 2;
        if (this.running >= limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
        this.running += 1;
    }

    private release(): void {
        this.running -= 1;
        this.waiting.shift()?.();
    }

    async render(html: string, paper: Paper): Promise<Uint8Array> {
        await this.acquire();
        const slot = (this.current ??= this.launch());
        slot.active += 1;
        try {
            const browser = await slot.browser;
            const page = await browser.newPage();
            try {
                const timeout = this.options.timeoutMs ?? 30_000;
                page.setDefaultTimeout(timeout);
                await page.setJavaScriptEnabled(false);
                await page.setOfflineMode(true);
                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    const url = request.url();
                    if (url.startsWith('data:') || url === 'about:blank') {
                        void request.continue();
                        return;
                    }
                    this.options.onBlocked?.(url);
                    void request.abort('blockedbyclient');
                });
                await page.setContent(html, { waitUntil: 'load', timeout });
                const size = PAGE[paper];
                const pdf = await page.pdf({
                    ...(size.format ? { format: size.format } : { width: size.width, height: size.height }),
                    printBackground: true,
                    preferCSSPageSize: true,
                    timeout
                });
                return new Uint8Array(pdf);
            } finally {
                await page.close().catch(() => undefined);
            }
        } finally {
            slot.active -= 1;
            slot.rendered += 1;
            if (slot.rendered >= (this.options.recycleAfter ?? 200)) {
                slot.retired = true;
                if (this.current === slot) this.current = undefined;
            }
            if (slot.retired && slot.active === 0) await this.closeSlot(slot);
            this.release();
        }
    }

    private async closeSlot(slot: Slot): Promise<void> {
        const browser = await slot.browser.catch(() => undefined);
        await browser?.close().catch(() => undefined);
    }

    async close(): Promise<void> {
        const slot = this.current;
        this.current = undefined;
        if (slot) await this.closeSlot(slot);
    }
}
