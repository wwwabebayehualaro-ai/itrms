import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UI from '@itrms/ui';

const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('@itrms/ui', async (original) => ({ ...(await original<typeof UI>()), saveBlob }));

import { FormsHostProvider } from '../host/FormsHost';
import { testHost } from '../test-utils';
import { useExportRequests } from '../viewer/exportApi';
import { savedViewKeys, useSavedViewMutations, type SavedView } from '../viewer/viewsApi';
import { UnsupportedChange, useSubmissionMutations } from './submissions';
import { templateKeys, useTemplateList, useTemplateMutations } from './templates';
import type { WireForm } from './wire';

const client = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };

const FORM_ID = '00000000-0000-4000-8000-000000000001';
const wireForm = (over: Partial<WireForm> = {}): WireForm => ({
    id: FORM_ID,
    version: 5,
    key: 'trip-request',
    name: { am: 'የጉዞ ጥያቄ', en: 'Trip request' },
    category: null,
    active: true,
    status: 'published',
    ownerUnit: { id: 'u1', code: 'Z', name: { en: 'Zone' } },
    publishedVersion: { id: 'ver-2', number: 2, publishedAt: '2026-10-20T07:00:00.000Z' },
    updatedAt: '2026-10-21T07:00:00.000Z',
    ...over
});

function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const host = testHost({ client });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <FormsHostProvider host={host}>{children}</FormsHostProvider>
        </QueryClientProvider>
    );
    return { queryClient, wrapper };
}

beforeEach(() => {
    for (const fn of Object.values(client)) fn.mockReset();
    saveBlob.mockReset();
});

describe('the engine’s hooks on the forms API', () => {
    it('lists the forms from v1/forms, as templates', async () => {
        client.get.mockResolvedValue({ data: { items: [wireForm()] } });
        const { wrapper } = setup();
        const { result } = renderHook(() => useTemplateList(), { wrapper });
        await waitFor(() => expect(result.current.data).toBeDefined());
        expect(client.get).toHaveBeenCalledWith('v1/forms', expect.objectContaining({ params: { limit: 100 } }));
        expect(result.current.data?.[0]).toMatchObject({ id: FORM_ID, slug: 'trip-request', status: 'published' });
    });

    it('creates a form with a key and a name in every first language, and publishing asks for a publication', async () => {
        client.post.mockImplementation((url: string) =>
            Promise.resolve({
                data: url.endsWith('/publications') ? { status: 'pending' } : wireForm({ status: 'draft' })
            })
        );
        const { wrapper } = setup();
        const { result } = renderHook(() => useTemplateMutations(), { wrapper });
        await act(() =>
            result.current.create.mutateAsync({
                name: 'Trip request',
                slug: 'Trip request',
                form_config: [{ id: 'a' }]
            })
        );
        expect(client.post).toHaveBeenCalledWith('v1/forms', {
            key: 'trip-request',
            name: { am: 'Trip request', en: 'Trip request' },
            document: { fields: [{ id: 'a' }] }
        });
        const published = await act(() => result.current.publish.mutateAsync({ id: FORM_ID, note: '  ' }));
        expect(client.post).toHaveBeenLastCalledWith(`v1/forms/${FORM_ID}/publications`, {});
        // a second person decides: until then it waits for approval
        expect(published.status).toBe('pending_approval');
    });

    it('switches a form off instead of deleting it, on the version the gallery shows', async () => {
        client.patch.mockResolvedValue({ data: wireForm({ active: false }) });
        client.get.mockResolvedValue({ data: { items: [] } });
        const { wrapper, queryClient } = setup();
        queryClient.setQueryData(templateKeys.list(), [{ id: FORM_ID, name: 'Trip', slug: 'trip', row_version: 5 }]);
        const { result } = renderHook(() => useTemplateMutations(), { wrapper });
        await act(() => result.current.remove.mutateAsync(FORM_ID));
        expect(client.patch).toHaveBeenCalledWith(
            `v1/forms/${FORM_ID}`,
            { active: false },
            { headers: { 'if-match': '"5"' } }
        );
    });

    it('files a request on the published version, and refuses to change one', async () => {
        client.get.mockImplementation((url: string) =>
            Promise.resolve({
                data: url.endsWith('/versions/published')
                    ? { id: 'ver-2', formId: FORM_ID, number: 2, document: { fields: [] }, createdAt: '' }
                    : wireForm()
            })
        );
        client.post.mockResolvedValue({
            data: {
                id: 's1',
                version: 1,
                formId: FORM_ID,
                formVersion: { id: 'ver-2', number: 2 },
                caseId: null,
                handlingUnit: { id: 'u1', code: 'Z', name: { en: 'Zone' } },
                answers: { destination: 'Sodo' },
                submittedBy: 'p1',
                submittedByName: 'Almaz T.',
                createdAt: '',
                updatedAt: ''
            }
        });
        const { wrapper } = setup();
        const { result } = renderHook(() => useSubmissionMutations(), { wrapper });
        const saved = await act(() =>
            result.current.create.mutateAsync({ template_id: FORM_ID, submission_data: { destination: 'Sodo' } })
        );
        expect(client.post).toHaveBeenCalledWith('v1/submissions', {
            formId: FORM_ID,
            formVersionId: 'ver-2',
            answers: { destination: 'Sodo' }
        });
        expect(saved.submitted_by_name).toBe('Almaz T.');
        await expect(result.current.update.mutateAsync({ id: 's1', data: {} })).rejects.toBeInstanceOf(
            UnsupportedChange
        );
    });

    it('changes a saved view on the version it was shown with, the office’s views as “unit”', async () => {
        client.patch.mockResolvedValue({
            data: {
                id: 'view-1',
                version: 4,
                formId: FORM_ID,
                name: 'Mine',
                visibility: 'unit',
                isDefault: false,
                config: { mode: 'table', sort: [], columns: [], pageSize: 20, options: {} },
                ownerId: 'p1',
                canEdit: true
            }
        });
        const { wrapper, queryClient } = setup();
        queryClient.setQueryData<Partial<SavedView>[]>(savedViewKeys.list({ templateId: FORM_ID }), [
            { id: 'view-1', row_version: 3 }
        ]);
        const { result } = renderHook(() => useSavedViewMutations(), { wrapper });
        await act(() => result.current.update.mutateAsync({ id: 'view-1', visibility: 'shared' }));
        expect(client.patch).toHaveBeenCalledWith(
            'v1/saved-views/view-1',
            { visibility: 'unit' },
            { headers: { 'if-match': '"3"' } }
        );
    });

    it('exports at once up to the direct limit, the filter in the API’s words', async () => {
        client.post.mockImplementation((url: string) =>
            Promise.resolve(
                url.endsWith('/query')
                    ? { data: { total: 12 } }
                    : {
                          data: new Blob(['a']),
                          headers: { 'content-disposition': 'attachment; filename="t.csv"', 'x-row-count': '12' }
                      }
            )
        );
        const { wrapper } = setup();
        const { result } = renderHook(() => useExportRequests(), { wrapper });
        const rows = await act(() =>
            result.current.mutateAsync({
                template_id: FORM_ID,
                filter: { op: 'and', items: [{ field: 'created_at', op: 'gte', value: '2026-10-01' }] }
            })
        );
        expect(rows).toBe(12);
        expect(client.post).toHaveBeenLastCalledWith(
            'v1/submissions/export',
            {
                formId: FORM_ID,
                format: 'csv',
                filter: { op: 'and', items: [{ field: 'createdAt', op: 'gte', value: '2026-10-01' }] },
                sort: []
            },
            { responseType: 'blob' }
        );
        expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 't.csv');
    });

    it('makes a larger export in the background and downloads it when it is ready', async () => {
        const opened: string[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            opened.push(this.href);
        });
        client.post.mockImplementation((url: string) =>
            Promise.resolve({
                data: url.endsWith('/query')
                    ? { total: 20_000 }
                    : url.endsWith('/download')
                      ? { url: 'https://files.example/export.csv' }
                      : { id: 'job-1', status: 'queued', rows: null, error: null }
            })
        );
        client.get.mockResolvedValue({ data: { id: 'job-1', status: 'done', rows: 20_000, error: null } });
        const { wrapper } = setup();
        const { result } = renderHook(() => useExportRequests(), { wrapper });
        const rows = await act(() => result.current.mutateAsync({ template_id: FORM_ID }));
        expect(rows).toBe(20_000);
        expect(client.post).toHaveBeenCalledWith('v1/submission-exports', { formId: FORM_ID, format: 'csv', sort: [] });
        expect(client.get).toHaveBeenCalledWith('v1/submission-exports/job-1');
        expect(opened).toEqual(['https://files.example/export.csv']);
        // never the direct export, which would refuse it
        expect(client.post).not.toHaveBeenCalledWith('v1/submissions/export', expect.anything(), expect.anything());
    }, 10_000);
});
