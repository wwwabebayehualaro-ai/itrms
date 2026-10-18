import { AxiosError, AxiosHeaders } from 'axios';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useZodForm, ZodForm } from '@platform/ui';

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

const rejected = (data: unknown) =>
    new AxiosError('failed', '422', undefined, undefined, { status: 422, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data });

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
        const onSubmit = vi.fn().mockRejectedValue(rejected({ detail: 'Invalid', errors: [{ field: 'key', message: 'Already taken' }, { field: 'x', message: 'Broken' }] }));
        render(<Probe onSubmit={onSubmit} />);
        await userEvent.type(screen.getByLabelText('Key'), 'abcd');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Already taken')).toBeInTheDocument();
        expect(screen.getByText('x: Broken')).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText('Key'), 'e');
        await waitFor(() => expect(screen.queryByText('Already taken')).not.toBeInTheDocument());
    });
});
