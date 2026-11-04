import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ServerErrorsProvider, useZodForm, ZodForm, type ServerErrorMapper } from '../index';
import { messagesOf } from './formKit';

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

/** Two fields filled in one after the other; the second may be needed only while a switch says so. */
function Pair({
    onSubmit,
    needSecond = true
}: {
    onSubmit: (v: { first: string; second: string }) => unknown;
    needSecond?: boolean;
}) {
    const pair = z
        .object({ first: z.string().min(3, 'First is needed'), second: z.string(), needs: z.boolean() })
        .superRefine((v, ctx) => {
            if (v.needs && v.second.length < 3)
                ctx.addIssue({ code: 'custom', path: ['second'], message: 'Second is needed' });
        })
        .transform(({ first, second }) => ({ first, second }));
    const form = useZodForm({
        schema: pair,
        defaultValues: { first: '', second: '', needs: needSecond },
        onSubmit
    });
    return (
        <ZodForm form={form}>
            <form.AppField name="first">{(f) => <f.TextField label="First" />}</form.AppField>
            <form.AppField name="second">{(f) => <f.TextField label="Second" />}</form.AppField>
            <form.AppField name="needs">{(f) => <f.SwitchField label="Needs the second" />}</form.AppField>
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

    it('shows a message once when the blur and the submit check both fail (found in a visual baseline)', async () => {
        render(<Probe onSubmit={vi.fn()} />);
        await userEvent.type(screen.getByLabelText('Key'), 'ab');
        await userEvent.tab(); // blur: the first validation run
        await userEvent.click(screen.getByRole('button', { name: 'Save' })); // submit: the second
        const error = await screen.findByText(/At least 3 characters/);
        expect(error.textContent?.match(/At least 3 characters/g)).toHaveLength(1);
        expect(messagesOf(['x', { message: 'x' }, 'y'])).toEqual(['x', 'y']);
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

    it('takes the save as soon as the fields are right, without leaving the last one (the cashier journey)', async () => {
        const onSubmit = vi.fn();
        render(<Pair onSubmit={onSubmit} />);
        await userEvent.type(screen.getByLabelText('First'), 'abc');
        // leaving the first field checks the whole form: the second, still empty, is refused
        await userEvent.tab();
        await userEvent.type(screen.getByLabelText('Second'), 'abc');
        expect(screen.queryByText('Second is needed')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
        // Enter in the last field saves: a disabled submit button would swallow it
        await userEvent.keyboard('{Enter}');
        await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ first: 'abc', second: 'abc' }));
    });

    it('drops a refusal another field caused, as soon as that field changes', async () => {
        render(<Pair onSubmit={vi.fn()} needSecond={false} />);
        await userEvent.click(screen.getByRole('switch', { name: 'Needs the second' }));
        await userEvent.type(screen.getByLabelText('First'), 'abc');
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
        await userEvent.click(screen.getByRole('switch', { name: 'Needs the second' }));
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('takes the same save again after the server failed it, the form untouched', async () => {
        const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Server unavailable'));
        render(<Probe onSubmit={onSubmit} />);
        await userEvent.type(screen.getByLabelText('Key'), 'abcd');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Server unavailable')).toBeInTheDocument();
        const save = screen.getByRole('button', { name: 'Save' });
        await waitFor(() => expect(save).toBeEnabled());
        await userEvent.click(save);
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByText('Server unavailable')).not.toBeInTheDocument());
    });

    it("clears the server's verdict on a field with a control of its own", async () => {
        const onSubmit = vi
            .fn()
            .mockRejectedValueOnce(new SaveError({ errors: [{ field: 'key', message: 'Already taken' }] }));
        function Custom() {
            const form = useZodForm({ schema, defaultValues: { key: 'abcd', description: '' }, onSubmit });
            return (
                <ZodForm form={form}>
                    <form.AppField name="key">
                        {(field) => (
                            <>
                                <input
                                    aria-label="Own control"
                                    value={field.state.value}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                />
                                <span>{messagesOf(field.state.meta.errors)}</span>
                            </>
                        )}
                    </form.AppField>
                    <form.AppForm>
                        <form.SubmitButton>Save</form.SubmitButton>
                    </form.AppForm>
                </ZodForm>
            );
        }
        render(
            <ServerErrorsProvider map={mapProblem}>
                <Custom />
            </ServerErrorsProvider>
        );
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Already taken')).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText('Own control'), 'e');
        await waitFor(() => expect(screen.queryByText('Already taken')).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
});
