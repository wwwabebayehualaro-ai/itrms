/**
 * What a checker is told, from the offline proof and the live status together (ADR-0046). The live status decides when there is
 * one. A proof alone says the facts are genuine, and can't say what happened to the document since it was printed.
 */
import { addisToday, checkQr, type PublishedKey, type QrCheck } from '@itrms/documents/contracts/verification-check';
import type { VerificationPayload } from '@itrms/documents/contracts';

import type { Lookup } from './lookup';

export type Verdict =
    | { kind: 'notOurs' }
    | { kind: 'forged' }
    | { kind: 'unknownKey' }
    | { kind: 'live'; lookup: Extract<Lookup, { state: 'found' }> }
    /** signed, not reachable: the most a phone in flight mode can say */
    | { kind: 'offline'; facts: VerificationPayload; expired: boolean };

export const verdictOf = (check: QrCheck, live: Lookup | null): Verdict => {
    if (check.state === 'notOurs' || check.state === 'forged') return { kind: check.state };
    if (check.state === 'unknownKey') return { kind: 'unknownKey' };
    if (live?.state === 'found') return { kind: 'live', lookup: live };
    // signed for a token no document has: it was withdrawn from this installation, or never was its own
    if (live?.state === 'unknown') return { kind: 'forged' };
    return { kind: 'offline', facts: check.facts, expired: check.expired };
};

export interface ExamineDeps {
    keys: () => readonly PublishedKey[];
    /** new keys if there is a connection: a phone offline since the last rotation lacks the newest */
    refresh: () => Promise<readonly PublishedKey[] | null>;
    lookUp: (token: string) => Promise<Lookup>;
    today?: () => string;
}

/** One scan, from its text to what to tell the checker. */
export async function examine(text: string, deps: ExamineDeps): Promise<Verdict> {
    const today = (deps.today ?? addisToday)();
    let check = await checkQr(text, deps.keys(), today);
    if (check.state === 'unknownKey') {
        const fresh = await deps.refresh();
        if (fresh) check = await checkQr(text, fresh, today);
    }
    if (check.state !== 'genuine') return verdictOf(check, null);
    return verdictOf(check, await deps.lookUp(check.token));
}
