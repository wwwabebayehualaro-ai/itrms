import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({ ...(await original<typeof UI>()), useNotify: () => notify }));

import { EngineForm } from './EngineForm';
import { hostRenderer } from '../test-utils';

const renderWithQuery = hostRenderer({ language: 'en', languages: ['am', 'en'] });

const field = (type: string, id: string, label: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label,
    category: 'Input',
    props: {},
    data: { defaultProps: {} },
    behavior: { validation: { supported: true } },
    layout: { options: { isContainer: false } },
    ...extra
});

describe('the Ethiopian date field (task 0.17b)', () => {
    it('shows the stored Gregorian day in the Ethiopian calendar and stores a picked day as the Gregorian day', async () => {
        const user = userEvent.setup();
        const onFormSubmit = vi.fn().mockResolvedValue(undefined);
        const fields = [field('EthDate', 'issued', 'Issued on', { props: { required: true } })];
        renderWithQuery(
            <EngineForm
                fields={fields}
                template={{ id: 'tpl-1', name: 'Licence', form_config: { fields } } as never}
                onFormSubmit={onFormSubmit}
                submissionId="s1"
                initialValues={{ issued: '2026-09-11' }}
            />
        );
        // 2026-09-11 is Meskerem 1, 2019 E.C.
        const trigger = screen.getByRole('button', { name: /Issued on/ });
        expect(trigger.textContent).toContain('1 Meskerem 2019 E.C.');
        await user.click(trigger);
        await user.click(screen.getByRole('button', { name: '5 Meskerem 2019 E.C.' }));
        await user.click(screen.getByRole('button', { name: /Submit|Save/ }));
        await waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
        expect(onFormSubmit.mock.calls[0]?.[0]).toMatchObject({ submission_data: { issued: '2026-09-15' } });
    });
});

describe('a conditional-required rule (task 0.17b)', () => {
    it('marks the field required only while its formula holds, and blocks the submit then', async () => {
        const user = userEvent.setup();
        const onFormSubmit = vi.fn().mockResolvedValue(undefined);
        const fields = [
            field('InputNumber', 'grade', 'Grade'),
            field('InputText', 'certificate', 'Medical certificate', {
                behavior: {
                    validation: {
                        supported: true,
                        requiredWhen: { expression: 'form.grade >= 3' },
                        errorMessages: {
                            required: { am: 'የሕክምና ማስረጃ ያስፈልጋል', en: 'A medical certificate is required' }
                        }
                    }
                }
            })
        ];
        const { container } = renderWithQuery(
            <EngineForm
                fields={fields}
                template={{ id: 'tpl-2', name: 'Licence', form_config: { fields } } as never}
                onFormSubmit={onFormSubmit}
            />
        );
        const marker = () => container.querySelector('[data-field-id="certificate"] .text-destructive');
        expect(marker()).toBeNull();
        await user.type(screen.getByLabelText(/Grade/), '4');
        await waitFor(() => expect(marker()).not.toBeNull());
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        expect(await screen.findByText('A medical certificate is required')).toBeInTheDocument();
        expect(onFormSubmit).not.toHaveBeenCalled();
        await user.clear(screen.getByLabelText(/Grade/));
        await user.type(screen.getByLabelText(/Grade/), '2');
        await waitFor(() => expect(marker()).toBeNull());
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        await waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
    });
});
