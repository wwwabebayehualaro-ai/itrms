// @vitest-environment happy-dom
/** The verification page (task 0.23b): what a checker is told in each case, in both languages, and nothing more. */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import am from '../messages/am.json';
import en from '../messages/en.json';
import { lookUp, tokenFromPath, VerifyPage, VerifyResult, type Lookup } from './VerifyPage';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const TOKEN = 'abcdefghijklmnopqrstuv';
const document = {
    status: 'valid',
    documentName: { am: 'ደረሰኝ', en: 'Receipt' },
    number: 'WOL-BODITI/000123/2019',
    office: { am: 'የናሙና ከተማ', en: 'Sample Town' },
    issuedOn: '2026-11-04',
    validUntil: null,
    holder: 'A**** K*****'
} as const;
const found = (status: string): Lookup => ({
    state: 'found',
    document: { ...document, status } as Extract<Lookup, { state: 'found' }>['document']
});

describe('the token in the address', () => {
    it('is 22 characters of base64url, and nothing else is asked for', () => {
        expect(tokenFromPath(`/${TOKEN}`)).toBe(TOKEN);
        expect(tokenFromPath(`/${TOKEN}/`)).toBe(TOKEN);
        expect(tokenFromPath('/')).toBeNull();
        expect(tokenFromPath('/short')).toBeNull();
        expect(tokenFromPath(`/../${TOKEN}`)).toBeNull();
        expect(tokenFromPath(`/a/${TOKEN}`)).toBeNull();
    });
});

describe('asking the API', () => {
    const answering = (status: number, body: unknown = {}) =>
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

    it('tells a found document, an unknown one, a limit and an outage apart', async () => {
        const ok = answering(200, document);
        expect(await lookUp(TOKEN, ok)).toEqual({ state: 'found', document });
        expect(ok).toHaveBeenCalledWith(`/v1/public/verifications/${TOKEN}`, expect.anything());
        expect(await lookUp(TOKEN, answering(404))).toEqual({ state: 'unknown' });
        expect(await lookUp(TOKEN, answering(429))).toEqual({ state: 'busy' });
        expect(await lookUp(TOKEN, answering(502))).toEqual({ state: 'offline' });
        const down = vi.fn(() => Promise.reject(new Error('no network'))) as unknown as typeof fetch;
        expect(await lookUp(TOKEN, down)).toEqual({ state: 'offline' });
    });
});

describe('what the page shows', () => {
    it.each(['valid', 'expired', 'revoked', 'superseded'])('says plainly when a document is %s', (status) => {
        render(<VerifyResult lookup={found(status)} words={en} language="en" />);
        const line = screen.getByRole('status');
        expect(line.dataset.state).toBe(status);
        expect(line.textContent).toBe(en[`verify.status.${status}` as keyof typeof en]);
    });

    it('shows the facts in the chosen language, Ethiopian dates, and only the masked name', () => {
        const { container } = render(<VerifyResult lookup={found('valid')} words={am} language="am" />);
        expect(container.textContent).toContain('ደረሰኝ');
        expect(container.textContent).toContain('WOL-BODITI/000123/2019');
        expect(container.textContent).toContain('ጥቅምት');
        expect(container.textContent).toContain('2019');
        expect(container.textContent).toContain('A**** K*****');
    });

    it.each(['unknown', 'busy', 'offline', 'loading'] as const)('has words for %s', (state) => {
        render(<VerifyResult lookup={{ state }} words={am} language="am" />);
        expect(screen.getByRole('status').textContent).toBe(am[`verify.state.${state}`]);
    });

    it('never asks the API without a token', async () => {
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        window.history.pushState({}, '', '/not-a-token');
        render(<VerifyPage />);
        await waitFor(() => expect(screen.getByRole('status').dataset.state).toBe('unknown'));
        expect(fetcher).not.toHaveBeenCalled();
    });
});
