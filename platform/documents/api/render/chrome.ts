/**
 * HTML to PDF in headless Chrome (ADR-0006, ADR-0031 §10). Only the `worker-documents` process loads this: the API and the
 * main worker never launch Chrome (dependency-cruiser: only-the-pdf-worker-reaches-chrome). A page runs with JavaScript off and
 * every request refused but its own inline data, and at most `pages` run at once; the browser is replaced now and then, so
 * its memory never grows without end.
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

export class PdfRenderer {
    private browser: Promise<Browser> | undefined;
    private running = 0;
    private rendered = 0;
    private readonly waiting: (() => void)[] = [];

    constructor(private readonly options: PdfRendererOptions) {}

    private launch(): Promise<Browser> {
        return puppeteer.launch({
            executablePath: this.options.executablePath,
            headless: true,
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
        });
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
        try {
            this.browser ??= this.launch();
            const browser = await this.browser;
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
                await page.evaluateHandle('document.fonts.ready').catch(() => undefined);
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
                this.rendered += 1;
                if (this.rendered >= (this.options.recycleAfter ?? 200) && this.running === 1)
                    await this.closeBrowser();
            }
        } finally {
            this.release();
        }
    }

    private async closeBrowser(): Promise<void> {
        const browser = this.browser;
        this.browser = undefined;
        this.rendered = 0;
        await (await browser)?.close().catch(() => undefined);
    }

    async close(): Promise<void> {
        await this.closeBrowser();
    }
}
