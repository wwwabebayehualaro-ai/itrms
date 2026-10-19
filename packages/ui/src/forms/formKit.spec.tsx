import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ServerErrorsProvider, useZodForm, ZodForm, type ServerErrorMapper } from '../index';

const schema = z.object({ key: z.string().min(3, 'At least 3 characters'), description: z.string() });

function Probe({ onSubmit }: { onSubmit: (v: z.output<typeof schema>) => unknown }) {
    const form = useZodForm({ schema, defaultValues: { key: '', description: '' }, onSubmit });
    return (
        <ZodForm form={form}>
            <form.AppField name="key">{(f) => <f.TextField label="Key" />}</form.AppField>
            <form.AppField name="description">{(f) => <f.TextareaField label="Description" />}</form.AppField>
            <form.AppForm>
                <form.SubmitButton>Save</form.SubmitButton>
            </form.AppForm>
        </ZodForm>
    );
}

/** A save failure as the app's API client throws it: problem+json `errors[]` in the response body. */
class SaveError extends Error {
    constructor(readonly body: { errors: { field: string; message: string }[] }) {
        super('failed');
    }
}

/** The app's mapper, reduced to what this test needs: known fields to the field, the rest to the form. */
const mapProblem: ServerErrorMapper = (error, known) => {
    const fields: Record<string, string> = {};
    const rest: string[] = [];
    for (const e of error instanceof SaveError ? error.body.errors : []) {
        if (known.includes(e.field)) fields[e.field] = e.message;
        else rest.push(`${e.field}: ${e.message}`);
    }
    return { fields, form: rest.join('; ') || undefined };
};

describe('useZodForm', () => {
    it('validates with the schema and does not submit invalid data', async () => {
        const onSubmit = vi.fn();
        render(<Probe onSubmit={onSubmit} />);
        await userEvent.type(screen.getByLabelText('Key'), 'ab');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('At least 3 characters')).toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits parsed values', async () => {
        const onSubmit = vi.fn();
        render(<Probe onSubmit={onSubmit} />);
        await userEvent.type(screen.getByLabelText('Key'), 'abcd');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ key: 'abcd', description: '' }));
    });

    it('shows server field errors on the field and the rest above the buttons', async () => {
        const onSubmit = vi.fn().mockRejectedValue(
            new SaveError({
                errors: [
                    { field: 'key', message: 'Already taken' },
                    { field: 'x', message: 'Broken' }
                ]
            })
        );
        render(
            <ServerErrorsProvider map={mapProblem}>
                <Probe onSubmit={onSubmit} />
            </ServerErrorsProvider>
        );
        await userEvent.type(screen.getByLabelText('Key'), 'abcd');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Already taken')).toBeInTheDocument();
        expect(screen.getByText('x: Broken')).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText('Key'), 'e');
        await waitFor(() => expect(screen.queryByText('Already taken')).not.toBeInTheDocument());
    });

    it('without a provider, shows the error message on the form', async () => {
        render(<Probe onSubmit={vi.fn().mockRejectedValue(new Error('Server unavailable'))} />);
        await userEvent.type(screen.getByLabelText('Key'), 'abcd');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Server unavailable')).toBeInTheDocument();
    });
});
