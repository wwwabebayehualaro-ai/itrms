/**
 * Wizard steps (task 1.13c): a form whose top level is steps is filled one step at a time. "Next" checks only the step shown and
 * keeps the values; "Back" keeps them too; a submit stopped by the whole form's check goes to the first step with an error; a step
 * its rule hides is skipped; read-only, every step is drawn.
 */
import { screen, within } from '@testing-library/react';
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
import { EngineForm, type EngineSubmission } from './EngineForm';
import { hostRenderer } from '../test-utils';

const render = hostRenderer({
    language: 'en',
    client,
    user: { id: 'u1', email: 'clerk@example.org', full_name: 'Clerk', roles: [], tenant_id: 't1', permissions: [] }
});

const field = (
    type: string,
    id: string,
    extra: { label?: string; parentId?: string; props?: Record<string, unknown>; behavior?: FormField['behavior'] } = {}
) => ({
    id,
    type,
    label: extra.label ?? id,
    category: type === 'FormStep' ? 'Layout' : 'Input',
    parentId: extra.parentId,
    props: extra.props ?? {},
    data: { defaultProps: {} },
    behavior: { validation: { supported: true }, ...extra.behavior },
    layout: { options: { isContainer: type === 'FormStep' } }
});

const fields: FormField[] = [
    field('FormStep', 'applicant', { label: 'Applicant' }),
    field('InputText', 'name', { label: 'Name', parentId: 'applicant', props: { required: true } }),
    field('Checkbox', 'company', { label: 'A company', parentId: 'applicant' }),
    // shown only for a company
    field('FormStep', 'company_step', {
        label: 'Company',
        behavior: { visibilityConditions: [{ field: 'company', operator: 'eq', value: true }] }
    }),
    field('InputText', 'tin', { label: 'TIN', parentId: 'company_step', props: { required: true } }),
    field('FormStep', 'vehicle', { label: 'Vehicle' }),
    field('InputText', 'plate', { label: 'Plate', parentId: 'vehicle', props: { required: true } }),
    // outside every step: on the last one
    field('InputText', 'note', { label: 'Note' })
];
const template = { id: 'tpl-w', name: 'Wizard', slug: 'wizard', form_config: { fields } } as FormTemplate;
const submitSpy = () => vi.fn<(s: EngineSubmission) => Promise<unknown>>().mockResolvedValue(undefined);
const steps = () => within(screen.getByRole('navigation', { name: 'Steps' }));

describe('a wizard', () => {
    it('shows one step at a time, checks only that step on Next, and keeps the values across the steps', async () => {
        const user = userEvent.setup();
        render(<EngineForm fields={fields} template={template} onFormSubmit={submitSpy()} />);

        // the company step is hidden by its rule: two steps
        expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
        expect(steps().getByText('Applicant').closest('li')).toHaveAttribute('aria-current', 'step');
        expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
        expect(screen.queryByLabelText(/^Plate/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();

        // Next with the step's required field empty: stays, and only that field's message shows
        await user.click(screen.getByRole('button', { name: 'Next' }));
        expect(await screen.findByText('Fix the fields of this step before going on.')).toBeInTheDocument();
        expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
        expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'true');

        await user.type(screen.getByLabelText(/^Name/), 'Sample Owner');
        await user.click(screen.getByRole('button', { name: 'Next' }));
        expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument();
        expect(screen.getByLabelText(/^Plate/)).toBeInTheDocument();
        // the fields outside every step come on the last one, with the form's own buttons
        expect(screen.getByLabelText(/^Note/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();

        // Back keeps what was typed
        await user.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByLabelText(/^Name/)).toHaveValue('Sample Owner');
    });

    it("takes in a step its rule shows, and submits every step's values from the last", async () => {
        const user = userEvent.setup();
        const onFormSubmit = submitSpy();
        render(<EngineForm fields={fields} template={template} onFormSubmit={onFormSubmit} />);

        await user.type(screen.getByLabelText(/^Name/), 'Sample Company');
        await user.click(screen.getByRole('checkbox', { name: /A company/ }));
        expect(await screen.findByText('Step 1 of 3')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Next' }));
        expect(await screen.findByText('Step 2 of 3')).toBeInTheDocument();
        await user.type(screen.getByLabelText(/^TIN/), '0012345678');
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await user.type(screen.getByLabelText(/^Plate/), 'ETH ABC 1234');
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        await vi.waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
        expect(onFormSubmit.mock.calls[0]?.[0].submission_data).toMatchObject({
            name: 'Sample Company',
            company: true,
            tin: '0012345678',
            plate: 'ETH ABC 1234'
        });
    });

    it('goes back to the first step with an error when the submit is stopped', async () => {
        // the first step's reason is shown, and required, only once the last step's plate is a defence one
        const linked: FormField[] = [
            field('FormStep', 'first', { label: 'First' }),
            field('InputText', 'name', { label: 'Name', parentId: 'first', props: { required: true } }),
            field('InputText', 'reason', {
                label: 'Reason',
                parentId: 'first',
                props: { required: true },
                behavior: { visibilityConditions: [{ field: 'plate', operator: 'eq', value: 'DEFENCE' }] }
            }),
            field('FormStep', 'second', { label: 'Second' }),
            field('InputText', 'plate', { label: 'Plate', parentId: 'second', props: { required: true } })
        ];
        const user = userEvent.setup();
        const onFormSubmit = submitSpy();
        render(
            <EngineForm
                fields={linked}
                template={{ ...template, form_config: { fields: linked } }}
                onFormSubmit={onFormSubmit}
            />
        );
        await user.type(screen.getByLabelText(/^Name/), 'Sample Owner');
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await user.type(await screen.findByLabelText(/^Plate/), 'DEFENCE');
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        // stopped: back on the first step, its new required field marked
        expect(await screen.findByText('Step 1 of 2')).toBeInTheDocument();
        expect(screen.getByLabelText(/^Reason/)).toHaveAttribute('aria-invalid', 'true');
        expect(steps().getByText('First').closest('li')).toHaveAttribute('aria-current', 'step');
        expect(onFormSubmit).not.toHaveBeenCalled();
    });

    it('draws every step in order when read only', () => {
        render(
            <EngineForm
                fields={fields}
                template={template}
                readOnly
                initialValues={{ name: 'Sample Owner', plate: 'ETH ABC 1234' }}
            />
        );
        expect(screen.queryByRole('navigation', { name: 'Steps' })).not.toBeInTheDocument();
        expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Plate/)).toBeInTheDocument();
    });
});
