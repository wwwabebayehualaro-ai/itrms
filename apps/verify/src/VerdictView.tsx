import type { VerificationOut, VerificationPayload } from '@itrms/documents/contracts';

import type { Lookup } from './lookup';
import { dayOf, Fact, type Language, type Words } from './shared';
import type { Verdict } from './verdict';

const textOf = (text: VerificationOut['office'], language: Language) => text[language] ?? text.am ?? text.en ?? '';

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

const templateName = (key: string, words: Words) => {
    const name = `verify.template.${key}`;
    return name in words ? words[name as keyof Words] : key;
};

/** All the QR carries: its template and office by their keys, since there is no room for their names on a licence card's code. */
function OfflineFacts({ facts, words, language }: { facts: VerificationPayload; words: Words; language: Language }) {
    return (
        <dl className="facts">
            <Fact term={words['verify.page.document']}>{templateName(facts.t, words)}</Fact>
            {facts.n && <Fact term={words['verify.page.number']}>{facts.n}</Fact>}
            <Fact term={words['verify.check.officeCode']}>{facts.o}</Fact>
            <Fact term={words['verify.page.issuedOn']}>{dayOf(facts.i, language)}</Fact>
            {facts.u && <Fact term={words['verify.page.validUntil']}>{dayOf(facts.u, language)}</Fact>}
            {facts.h && <Fact term={words['verify.page.holder']}>{facts.h}</Fact>}
        </dl>
    );
}

export function VerdictView({ verdict, words, language }: { verdict: Verdict; words: Words; language: Language }) {
    if (verdict.kind === 'live')
        return (
            <div data-verdict={verdict.lookup.document.status}>
                <VerifyResult lookup={verdict.lookup} words={words} language={language} />
            </div>
        );
    if (verdict.kind === 'offline') {
        const kind = verdict.expired ? 'offlineExpired' : 'offlineGood';
        return (
            <div data-verdict={kind}>
                <p className={`status status-${kind}`} role="status">
                    {words[`verify.check.${kind}`]}
                </p>
                <OfflineFacts facts={verdict.facts} words={words} language={language} />
                <p className="hint">{words['verify.page.compare']}</p>
            </div>
        );
    }
    return (
        <p className={`status status-${verdict.kind}`} role="status" data-verdict={verdict.kind}>
            {words[`verify.check.${verdict.kind}`]}
        </p>
    );
}
