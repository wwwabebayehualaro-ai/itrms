'use client';

/**
 * The public verification page (ADR-0045, task 0.23b): whoever scans a document's QR arrives at `verify.page.<domain>/<token>`. It asks
 * the API for the document's status and shows a checker's minimum. No sign-in, no cookies, nothing kept. The part of the QR after
 * `#` stays on this phone: the offline check (task 0.23c) reads it.
 */
import { useEffect, useState } from 'react';
import { formatEthiopianLong, toEthiopian } from '@itrms/ethiopian-calendar';
import type { VerificationOut } from '@itrms/documents/contracts';

import am from '../messages/am.json';
import en from '../messages/en.json';

type Language = 'am' | 'en';
type Words = typeof en;

export type Lookup =
    | { state: 'loading' }
    | { state: 'found'; document: VerificationOut }
    | { state: 'unknown' }
    | { state: 'busy' }
    | { state: 'offline' };

// the contracts' VERIFICATION_TOKEN and statuses: this public page carries no validation library
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const STATUSES = new Set<string>(['valid', 'expired', 'revoked', 'superseded']);
const TIMEOUT_MS = 20_000;

/** The token in the address, or nothing. */
export const tokenFromPath = (pathname: string): string | null => {
    const token = pathname.replace(/^\/+|\/+$/g, '');
    return TOKEN.test(token) ? token : null;
};

/** What the API says of a token, as this page can show it. */
export async function lookUp(token: string, fetcher: typeof fetch = fetch): Promise<Lookup> {
    try {
        const response = await fetcher(`/v1/public/verifications/${token}`, {
            headers: { accept: 'application/json' },
            // a stalled connection reaches "try again" too, on the links this page is made for
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (response.status === 404) return { state: 'unknown' };
        if (response.status === 429) return { state: 'busy' };
        if (!response.ok) return { state: 'offline' };
        const document = (await response.json()) as VerificationOut;
        return STATUSES.has(document.status) ? { state: 'found', document } : { state: 'offline' };
    } catch {
        return { state: 'offline' };
    }
}

/** What the page's address says: an address with no token is not asked about. */
export const lookUpAddress = async (pathname: string, fetcher?: typeof fetch): Promise<Lookup> => {
    const token = tokenFromPath(pathname);
    return token ? lookUp(token, fetcher) : { state: 'unknown' };
};

const dayOf = (day: string, language: Language) => {
    const [year = 0, month = 0, date = 0] = day.split('-').map(Number);
    return formatEthiopianLong(toEthiopian({ year, month, day: date }), { language });
};

const textOf = (text: VerificationOut['office'], language: Language) => text[language] ?? text.am ?? text.en ?? '';

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
    return (
        <div className="fact">
            <dt>{term}</dt>
            <dd>{children}</dd>
        </div>
    );
}

export function VerifyResult({ lookup, words, language }: { lookup: Lookup; words: Words; language: Language }) {
    if (lookup.state !== 'found')
        return (
            <p className={`status status-${lookup.state}`} role="status" data-state={lookup.state}>
                {words[`verify.page.state.${lookup.state}`]}
            </p>
        );
    const { document: d } = lookup;
    return (
        <>
            <p className={`status status-${d.status}`} role="status" data-state={d.status}>
                {words[`verify.page.status.${d.status}`]}
            </p>
            <dl className="facts">
                <Fact term={words['verify.page.document']}>{textOf(d.documentName, language)}</Fact>
                {d.number && <Fact term={words['verify.page.number']}>{d.number}</Fact>}
                <Fact term={words['verify.page.office']}>{textOf(d.office, language)}</Fact>
                <Fact term={words['verify.page.issuedOn']}>{dayOf(d.issuedOn, language)}</Fact>
                {d.validUntil && <Fact term={words['verify.page.validUntil']}>{dayOf(d.validUntil, language)}</Fact>}
                {d.holder && <Fact term={words['verify.page.holder']}>{d.holder}</Fact>}
            </dl>
            <p className="hint">{words['verify.page.compare']}</p>
        </>
    );
}

export function VerifyPage() {
    const [language, setLanguage] = useState<Language>('am');
    const [lookup, setLookup] = useState<Lookup>({ state: 'loading' });
    useEffect(() => {
        void lookUpAddress(window.location.pathname).then(setLookup);
    }, []);
    const words = language === 'en' ? en : am;
    return (
        <main lang={language}>
            <header>
                <h1>{words['verify.page.title']}</h1>
                <button type="button" onClick={() => setLanguage(language === 'am' ? 'en' : 'am')}>
                    {words['verify.page.otherLanguage']}
                </button>
            </header>
            <VerifyResult lookup={lookup} words={words} language={language} />
        </main>
    );
}
