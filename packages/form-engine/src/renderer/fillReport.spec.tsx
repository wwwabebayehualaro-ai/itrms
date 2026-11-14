/**
 * A fill's moments for the form's analytics (task 1.13f): opened when the form is shown, stopped by its checks with the keys of the
 * fields in error (never their values), submitted with the seconds it took; nothing from a read-only view or the builder's
 * preview, nor for a form without a published version.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), request: vi.fn() }));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({
    ...(await original<typeof UI>()),
    useNotify: () => notify
}));

import type { FormField, FormTemplate } from '@itrms/schemas';
import { EngineForm } from './EngineForm';
import { hostRenderer } from '../test-utils';

const render = hostRenderer({
    language: 'en',
    client,
    user: { id: 'u1', email: 'clerk@example.org', full_name: 'Clerk', roles: [], tenant_id: 't1', permissions: [] }
});

const fields: FormField[] = [
    {
        id: 'fullName',
        type: 'InputText',
        label: 'Full name',
        category: 'Input',
        props: { required: true },
        data: { defaultProps: {} },
        behavior: { validation: { supported: true } },
        layout: { options: { isContainer: false } }
    }
];
const template = (published: string | null) =>
    ({ id: 'tpl-a', name: 'A', slug: 'a', form_config: { fields }, published_version_id: published }) as FormTemplate;
const events = () =>
    client.post.mock.calls
        .filter(([url]) => url === 'v1/forms/tpl-a/events')
        .map(([, body]) => body as Record<string, unknown>);

describe('a fill reported to the form analytics', () => {
    it('is opened when shown, stopped with the keys in error, then submitted with its time', async () => {
        client.post.mockReset();
        client.post.mockResolvedValue({ data: undefined });
        const user = userEvent.setup();
        render(
            <EngineForm
                fields={fields}
                template={template('v-1')}
                onFormSubmit={vi.fn().mockResolvedValue(undefined)}
            />
        );
        await waitFor(() => expect(events().map((e) => e.kind)).toEqual(['opened']));
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        await waitFor(() => expect(events().map((e) => e.kind)).toEqual(['opened', 'blocked']));
        expect(events()[1]).toMatchObject({ formVersionId: 'v-1', fieldKeys: ['fullName'] });
        await user.type(screen.getByLabelText(/^Full name/), 'Sample Applicant');
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        // submitted, then the cleared form starts a new fill
        await waitFor(() => expect(events().map((e) => e.kind)).toEqual(['opened', 'blocked', 'submitted', 'opened']));
        const [opened, blocked, submitted, next] = events();
        // one sitting, one fill id; no answer ever goes with the moments
        expect(new Set([opened?.fill, blocked?.fill, submitted?.fill]).size).toBe(1);
        expect(next?.fill).not.toBe(opened?.fill);
        expect(typeof submitted?.seconds).toBe('number');
        expect(JSON.stringify(events())).not.toContain('Sample Applicant');
    });

    it('reports nothing read only, in the builder preview, or for a form with no published version', async () => {
        client.post.mockReset();
        client.post.mockResolvedValue({ data: undefined });
        render(<EngineForm fields={fields} template={template('v-1')} readOnly />);
        render(<EngineForm fields={fields} template={template('v-1')} reportFill={false} />);
        render(<EngineForm fields={fields} template={template(null)} />);
        await new Promise((r) => setTimeout(r, 50));
        expect(events()).toEqual([]);
    });
});
