'use client';

/**
 * The public verification page (ADR-0045, task 0.23b): whoever scans a document's QR arrives at `verify.<domain>/<token>`. It asks
 * the API for the document's status and shows a checker's minimum. No sign-in, no cookies. The part of the QR after `#` stays on
 * this phone: when the API can't be reached, it proves the document here, if this phone has the keys (ADR-0046).
 */
import { useEffect, useState } from 'react';
import { addisToday, checkQr } from '@itrms/documents/contracts/verification-check';

import { refreshKeys, storedKeys } from './keys';
import { lookUpAddress, type Lookup } from './lookup';
import { Frame, useLanguage } from './shared';
import { verdictOf, type Verdict } from './verdict';
import { VerdictView, VerifyResult } from './VerdictView';

/** What the part after `#` proves, when the API gave no answer. Without the keys, it proves nothing either way. */
async function proofInAddress(live: Lookup): Promise<Verdict | null> {
    const check = await checkQr(window.location.href, storedKeys()?.keys ?? [], addisToday());
    return check.state === 'genuine' || check.state === 'forged' ? verdictOf(check, live) : null;
}

export function VerifyPage() {
    const { language, words, other } = useLanguage();
    const [lookup, setLookup] = useState<Lookup>({ state: 'loading' });
    const [verdict, setVerdict] = useState<Verdict | null>(null);
    useEffect(() => {
        void (async () => {
            const live = await lookUpAddress(window.location.pathname);
            if (live.state === 'offline' || live.state === 'busy') setVerdict(await proofInAddress(live));
            setLookup(live);
            if (live.state !== 'offline') await refreshKeys();
        })();
    }, []);
    return (
        <Frame language={language} words={words} other={other} title={words['verify.page.title']}>
            {verdict ? (
                <VerdictView verdict={verdict} words={words} language={language} />
            ) : (
                <VerifyResult lookup={lookup} words={words} language={language} />
            )}
            <div className="actions">
                <a className="button" href="/scan" data-to-scan>
                    {words['verify.page.scan']}
                </a>
            </div>
        </Frame>
    );
}
