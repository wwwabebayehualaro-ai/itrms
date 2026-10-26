import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({ ...(await original<typeof UI>()), useNotify: () => notify }));

import { amText, hostRenderer } from '../test-utils';
import { EngineForm } from './EngineForm';

afterEach(() => vi.unstubAllGlobals());

const STORED = { id: 'f-1', filename: 'photo.png', contentType: 'image/png', size: 4, documentType: 'photo' };
const answer = <T,>(data: T) => Promise.resolve({ data, status: 200, headers: {} });

describe('an attachment field with a document type (task 0.18)', () => {
    it('asks for the upload with the type, keeps it in the answer and shows it', async () => {
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 204 })));
        const post = vi.fn((url: string) =>
            answer(
                url.endsWith('/confirm')
                    ? STORED
                    : { file: { id: 'f-1' }, upload: { kind: 'post', url: '/files/b', fields: { key: 'k' } } }
            )
        );
        const onFormSubmit = vi
            .fn<(submission: { submission_data: Record<string, unknown> }) => Promise<void>>()
            .mockResolvedValue(undefined);
        const fields = [
            {
                id: 'picture',
                type: 'FileUpload',
                label: 'Picture',
                category: 'Input',
                props: { docType: 'photo' },
                data: { defaultProps: {} },
                behavior: { validation: { supported: true } },
                layout: { options: { isContainer: false } }
            }
        ];
        const { container } = hostRenderer({ client: { post: post as never } })(
            <EngineForm
                fields={fields}
                template={{ id: 'tpl-1', name: 'Licence', form_config: { fields } } as never}
                onFormSubmit={onFormSubmit}
            />
        );
        const input = container.querySelector('input[type="file"]');
        if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
        await userEvent.upload(input, new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' }));
        expect(await screen.findByText(amText('form-engine.core.documentType.photo'))).toBeTruthy();
        expect(post).toHaveBeenCalledWith('v1/files', expect.objectContaining({ documentType: 'photo' }));
        await userEvent.click(screen.getByRole('button', { name: amText('form-engine.renderer.submit.label') }));
        await waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
        expect(onFormSubmit.mock.calls[0]?.[0].submission_data.picture).toEqual([
            { file_id: 'f-1', name: 'photo.png', size: 4, type: 'image/png', documentType: 'photo' }
        ]);
    });
});
