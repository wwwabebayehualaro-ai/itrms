import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), request: vi.fn() }));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({
    ...(await original<typeof UI>()),
    useNotify: () => notify
}));

import { readDocument } from '../core';
import { EngineForm, canRenderWithEngine } from './EngineForm';
import FormRenderer from './FormRenderer';
import { amText, enText, hostRenderer } from '../test-utils';

const ALL = ['form:create', 'form:update', 'form:publish', 'submission:create', 'submission:read', 'submission:export'];
// the specs read the engine's words in English; the Amharic ones say so (`renderInAmharic`)
const renderWithQuery = hostRenderer({
    language: 'en',
    client,
    user: {
        id: 'u1',
        email: 'maker@example.org',
        full_name: 'Maker',
        roles: ['editor'],
        tenant_id: 't1',
        permissions: ALL
    }
});

const field = (type: string, id: string, extra: Record<string, any> = {}) => ({
    id,
    type,
    label: extra.label ?? id,
    category: extra.category ?? (type === 'FormArray' || type === 'Panel' ? 'Layout' : 'Input'),
    parentId: extra.parentId,
    props: extra.props ?? {},
    data: { defaultProps: {} },
    behavior: { validation: { supported: true }, ...extra.behavior },
    layout: { options: { isContainer: type === 'FormArray' || type === 'Panel' } }
});

const fields: any[] = [
    field('InputText', 'title', { label: 'Title', props: { required: true } }),
    field('InputNumber', 'amount', { label: 'Amount', props: { required: true } }),
    field('InputText', 'reason', {
        label: 'Reason',
        props: { required: true },
        behavior: { visibilityConditions: [{ field: 'amount', operator: 'gt', value: 100 }] }
    }),
    field('Checkbox', 'urgent', { label: 'Urgent' }),
    field('FormArray', 'lines', {
        label: 'Lines',
        props: { minItems: 1, itemLabel: 'Line', addButtonLabel: 'Add line' }
    }),
    field('InputText', 'what', { label: 'What', parentId: 'lines', props: { required: true } })
];
const template = { id: 'tpl-1', name: 'Expense', form_config: { fields } } as any;

describe('EngineForm', () => {
    it('blocks a submit with errors, then submits the visible values', async () => {
        const user = userEvent.setup();
        const onFormSubmit = vi.fn().mockResolvedValue(undefined);
        renderWithQuery(<EngineForm fields={fields} template={template} onFormSubmit={onFormSubmit} />);

        await user.click(screen.getByRole('button', { name: 'Submit' }));
        expect(await screen.findByText('Please fix 3 fields before submitting.')).toBeInTheDocument();
        expect(onFormSubmit).not.toHaveBeenCalled();
        expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument(); // hidden until the amount is over 100

        await user.type(screen.getByLabelText(/Title/), 'Trip');
        await user.type(screen.getByLabelText(/Amount/), '250');
        expect(await screen.findByLabelText(/Reason/)).toBeInTheDocument();
        await user.type(screen.getByLabelText(/Reason/), 'Client visit');
        await user.type(within(screen.getByRole('group', { name: 'Line 1' })).getByLabelText(/What/), 'Taxi');
        await user.click(screen.getByRole('button', { name: 'Add line' }));
        await user.type(within(screen.getByRole('group', { name: 'Line 2' })).getByLabelText(/What/), 'Hotel');
        await user.click(screen.getByRole('checkbox', { name: /Urgent/ }));

        await user.click(screen.getByRole('button', { name: 'Submit' }));
        await waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
        expect(onFormSubmit.mock.calls[0]?.[0]).toMatchObject({
            template_id: 'tpl-1',
            status: 'submitted',
            submission_data: {
                title: 'Trip',
                amount: 250,
                reason: 'Client visit',
                urgent: true,
                lines: [{ what: 'Taxi' }, { what: 'Hotel' }]
            }
        });
        expect(notify.success).toHaveBeenCalledWith('Submitted successfully');
    });

    it('does not submit the value of a field that became hidden', async () => {
        const user = userEvent.setup();
        const onFormSubmit = vi.fn().mockResolvedValue(undefined);
        renderWithQuery(
            <EngineForm
                fields={fields}
                template={template}
                onFormSubmit={onFormSubmit}
                submissionId="s1"
                initialValues={{ title: 'Old', amount: 500, reason: 'Was needed', lines: [{ what: 'Desk' }] }}
            />
        );
        const amount = screen.getByLabelText(/Amount/);
        await user.clear(amount);
        await user.type(amount, '20');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
        expect(onFormSubmit.mock.calls[0]?.[0].submission_data).toEqual({
            title: 'Old',
            amount: 20,
            urgent: false,
            lines: [{ what: 'Desk' }]
        });
    });

    it('shows a saved record read-only, without buttons', () => {
        renderWithQuery(
            <EngineForm
                fields={fields}
                template={template}
                readOnly
                initialValues={{ title: 'Trip', amount: 250, reason: 'Client', lines: [{ what: 'Taxi' }] }}
            />
        );
        expect(screen.getByLabelText(/Title/)).toBeDisabled();
        expect(screen.getByLabelText(/Title/)).toHaveValue('Trip');
        expect(screen.getByLabelText(/Reason/)).toHaveValue('Client');
        expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add line' })).not.toBeInTheDocument();
    });

    it('tells which fields of a form the field kit cannot draw', () => {
        expect(canRenderWithEngine(readDocument({ fields }))).toBe(true);
        expect(
            canRenderWithEngine(readDocument({ fields: [...fields, field('TabView', 'tabs', { category: 'Layout' })] }))
        ).toBe(false);
        expect(
            canRenderWithEngine(
                readDocument({ fields: [field('Calendar', 'when', { props: { selectionMode: 'range' } })] })
            )
        ).toBe(false);
        renderWithQuery(
            <FormRenderer
                fields={[...fields, field('TabView', 'tabs', { label: 'Tabs', category: 'Layout' })]}
                template={template}
            />
        );
        expect(screen.getByText('Part of this form cannot be shown')).toBeInTheDocument();
        expect(screen.getByText(/Not shown: Tabs/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Title/)).toBeInTheDocument(); // the rest of the form is there
    });

    it('keeps a saved choice from an API list while the list loads', async () => {
        let answer!: (v: unknown) => void;
        client.request.mockReturnValue(new Promise((resolve) => (answer = resolve)));
        const approver = {
            ...field('Dropdown', 'approver', { label: 'Approver', props: { required: true } }),
            data: { defaultProps: {}, optionsBinding: { dataSourceId: 'directory' } }
        };
        const runtime = {
            dataSources: [
                {
                    id: 'directory',
                    request: { method: 'GET', url: '/auth/directory' },
                    responseMapping: { options: { labelPath: 'full_name', valuePath: 'id' } }
                }
            ]
        } as any;
        const onFormSubmit = vi.fn().mockResolvedValue(undefined);
        renderWithQuery(
            <EngineForm
                fields={[approver]}
                template={template}
                runtime={runtime}
                submissionId="s1"
                initialValues={{ approver: 'u2' }}
                onFormSubmit={onFormSubmit}
            />
        );
        await waitFor(() => expect(client.request).toHaveBeenCalled());
        answer({
            data: [
                { id: 'u1', full_name: 'Ada Admin' },
                { id: 'u2', full_name: 'David Chen' }
            ]
        });
        await waitFor(() => expect(screen.getByRole('combobox', { name: /Approver/ })).toHaveTextContent('David Chen'));
        await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
        expect(onFormSubmit.mock.calls[0]?.[0].submission_data).toEqual({ approver: 'u2' });
    });
    it('says its own words in the form’s language, Amharic by default for the screens', () => {
        const renderInAmharic = hostRenderer({ language: 'am' });
        renderInAmharic(<EngineForm fields={fields} template={template} onFormSubmit={vi.fn()} />);
        expect(screen.getByRole('button', { name: amText('form-engine.renderer.submit.label') })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: amText('form-engine.renderer.submit.clear') })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    });

    it('draws the form’s own language, whatever language the screens are in', () => {
        const renderInAmharic = hostRenderer({ language: 'am' });
        renderInAmharic(<EngineForm fields={fields} template={template} onFormSubmit={vi.fn()} language="en" />);
        expect(screen.getByRole('button', { name: enText('form-engine.renderer.submit.label') })).toBeInTheDocument();
    });
});
