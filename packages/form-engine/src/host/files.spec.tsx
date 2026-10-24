// Attachment fields' uploads (task 0.15): through the FormsClient the API is asked for a ticket, the bytes go to the
// store's presigned URL (never through the API), and the upload is confirmed with the file's SHA-256.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FormsClient } from './client';
import { FormsHostProvider } from './FormsHost';
import { filenameFromDisposition, useFileActions } from './files';

const STORED = { id: 'f-1', filename: 'ፎቶ.png', contentType: 'image/png', size: 4, documentType: 'photo' };

function fakeClient(ticket: unknown) {
    const calls: { method: string; url: string; data?: unknown }[] = [];
    const respond = <T,>(data: unknown) => Promise.resolve({ data: data as T, status: 200, headers: {} });
    const client = {
        post: (url: string, data?: unknown) => {
            calls.push({ method: 'POST', url, data });
            return respond(url.endsWith('/confirm') ? STORED : ticket);
        },
        get: (url: string) => {
            calls.push({ method: 'GET', url });
            return respond({ url: '/files/b/files/r/f-1?X-Amz-Signature=s' });
        }
    } as unknown as FormsClient;
    return { client, calls };
}

function wrapper(client: FormsClient) {
    const queries = new QueryClient();
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queries}>
            <FormsHostProvider
                host={{
                    client,
                    useUser: () => null,
                    useLocation: () =>
                        ({ pathname: '/', searchParams: new URLSearchParams(), push: () => undefined }) as never,
                    templatesHref: '/'
                }}
            >
                {children}
            </FormsHostProvider>
        </QueryClientProvider>
    );
}

afterEach(() => vi.unstubAllGlobals());

describe('an attachment upload', () => {
    it('asks for a ticket with the SHA-256, posts the bytes to the store, then confirms', async () => {
        const sent: { url: string; init?: RequestInit }[] = [];
        vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
            sent.push({ url, init });
            return Promise.resolve(new Response(null, { status: 204 }));
        });
        const { client, calls } = fakeClient({
            file: { id: 'f-1' },
            upload: { kind: 'post', url: '/files/b', fields: { key: 'quarantine/r/f-1', Policy: 'p' } }
        });
        const { result } = renderHook(() => useFileActions(), { wrapper: wrapper(client) });
        const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'ፎቶ.png', { type: 'image/png' });
        let out: unknown;
        await act(async () => {
            out = await result.current.uploadFile({ file, documentType: 'photo' });
        });
        expect(calls[0]).toMatchObject({
            url: 'v1/files',
            data: {
                filename: 'ፎቶ.png',
                contentType: 'image/png',
                size: 4,
                sha256: '0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543',
                documentType: 'photo'
            }
        });
        expect(sent.map((s) => [s.url, s.init?.method])).toEqual([['/files/b', 'POST']]);
        expect([...(sent[0]?.init?.body as FormData).keys()]).toEqual(['key', 'Policy', 'file']);
        expect(calls[1]).toMatchObject({ url: 'v1/files/f-1/confirm' });
        expect(out).toMatchObject({ file_id: 'f-1', filename: 'ፎቶ.png', content_type: 'image/png', size: 4 });
    });

    it('sends a large file in its parts and confirms with their ETags', async () => {
        const sent: string[] = [];
        vi.stubGlobal('fetch', (url: string) => {
            sent.push(url);
            return Promise.resolve(new Response(null, { status: 200, headers: { etag: `"e${sent.length}"` } }));
        });
        const { client, calls } = fakeClient({
            file: { id: 'f-1' },
            upload: {
                kind: 'parts',
                parts: [
                    { partNumber: 1, size: 3, url: '/files/b/k?partNumber=1' },
                    { partNumber: 2, size: 1, url: '/files/b/k?partNumber=2' }
                ]
            }
        });
        const { result } = renderHook(() => useFileActions(), { wrapper: wrapper(client) });
        await act(async () => {
            await result.current.uploadFile({
                file: new File([new Uint8Array(4)], 'a.pdf', { type: 'application/pdf' })
            });
        });
        expect(sent).toEqual(['/files/b/k?partNumber=1', '/files/b/k?partNumber=2']);
        expect(calls[1]).toMatchObject({
            data: {
                parts: [
                    { partNumber: 1, etag: '"e1"' },
                    { partNumber: 2, etag: '"e2"' }
                ]
            }
        });
    });
});

describe('a download name', () => {
    it('is the UTF-8 name when the header has one, else the plain one', () => {
        expect(
            filenameFromDisposition(`attachment; filename="___.png"; filename*=UTF-8''%E1%8D%8E%E1%89%B6.png`, 'x')
        ).toBe('ፎቶ.png');
        expect(filenameFromDisposition('attachment; filename="scan.pdf"', 'x')).toBe('scan.pdf');
        expect(filenameFromDisposition(undefined, 'x')).toBe('x');
    });
});
