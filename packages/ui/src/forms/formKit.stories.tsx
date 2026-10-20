import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { userEvent, within } from 'storybook/test';
import { z } from 'zod';

import { TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import { useZodForm, ZodForm } from './formKit';

// `useZodForm` and `ZodForm` are hooks and wrappers around the primitives, so the story renders a small form with them.
const meta = {
    title: 'Forms/formKit',
    component: ZodForm,
    // required by the type; every story renders its own form
    args: { form: { handleSubmit: () => undefined, AppForm: () => null, FormError: () => null }, children: null }
} satisfies Meta<typeof ZodForm>;

export default meta;
type Story = StoryObj<typeof meta>;

function ApplicationForm({ long }: { long?: boolean }) {
    const words = useTexts({
        required: TEXT.requiredError,
        name: long ? TEXT.longLabel : TEXT.applicantName,
        notes: TEXT.notes,
        woreda: TEXT.woreda,
        sodoZuria: TEXT.sodoZuria,
        humbo: TEXT.humbo,
        pick: TEXT.selectWoreda,
        sms: TEXT.notifySms,
        help: TEXT.applicationHelp
    });
    // The schema carries the (translated) messages, the way a screen builds it from its catalogue.
    const schema = useMemo(
        () =>
            z.object({
                name: z.string().min(1, words.required),
                notes: z.string(),
                woreda: z.string(),
                sms: z.boolean()
            }),
        [words.required]
    );
    const form = useZodForm({
        schema,
        defaultValues: { name: '', notes: '', woreda: '', sms: true },
        onSubmit: () => undefined
    });
    return (
        <div className="max-w-md">
            <ZodForm form={form}>
                <form.AppField name="name">
                    {(f) => <f.TextField label={words.name} description={words.help} />}
                </form.AppField>
                <form.AppField name="woreda">
                    {(f) => (
                        <f.SelectField
                            label={words.woreda}
                            placeholder={words.pick}
                            options={[
                                { value: 'sodo-zuria', label: words.sodoZuria },
                                { value: 'humbo', label: words.humbo }
                            ]}
                        />
                    )}
                </form.AppField>
                <form.AppField name="notes">{(f) => <f.TextareaField label={words.notes} />}</form.AppField>
                <form.AppField name="sms">{(f) => <f.SwitchField label={words.sms} />}</form.AppField>
                <form.AppForm>
                    <form.SubmitButton>
                        <T text={TEXT.submit} />
                    </form.SubmitButton>
                </form.AppForm>
            </ZodForm>
        </div>
    );
}

export const Default: Story = { render: () => <ApplicationForm /> };

/** The play function submits the empty form: the required field shows its message and the field is marked invalid. */
export const RequiredFieldError: Story = {
    render: () => <ApplicationForm />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole('button'));
        await canvas.findByRole('alert');
    }
};

export const LongText: Story = { render: () => <ApplicationForm long /> };
