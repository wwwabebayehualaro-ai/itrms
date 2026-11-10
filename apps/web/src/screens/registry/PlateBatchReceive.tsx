'use client';

/**
 * Receiving a delivery of plates from the federal source (task 1.2a): the dispatch reference, the day it arrived (picked on
 * the Ethiopian calendar, stored Gregorian) and the run of one series (ABC 0001 to 0500). The plates enter this office's stock.
 */
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { plateBatchReceiveSchema } from '@itrms/vehicles/contracts';
import {
    Alert,
    AlertDescription,
    Button,
    EthiopianDatePicker,
    Label,
    PageHeader,
    useZodForm,
    ZodForm
} from '@itrms/ui';
import { z } from 'zod';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useReceiveBatch } from '@/lib/plate-stock';
import { usePreferences, useText } from '@/lib/preferences';

function formSchema(t: (key: string) => string) {
    const whole = (v: string) => /^\d{1,4}$/.test(v.trim());
    return z.object({
        reference: z.string().refine((v) => v.trim() !== '', t('vehicles.plateStock.required')),
        receivedOn: z.string().refine((v) => v !== '', t('vehicles.plateStock.required')),
        series: z.string().refine((v) => /^[A-Za-z]{3}$/.test(v.trim()), t('vehicles.plateStock.seriesHint')),
        from: z.string().refine(whole, t('vehicles.plateStock.serialHint')),
        to: z.string().refine(whole, t('vehicles.plateStock.serialHint')),
        note: z.string().max(500)
    });
}
type FormValues = z.infer<ReturnType<typeof formSchema>>;

export function PlateBatchReceive() {
    const { t, language } = useText();
    const router = useRouter();
    const calendar = usePreferences((s) => s.calendar);
    const receive = useReceiveBatch();
    const [problem, setProblem] = useState<string>();
    const schema = useMemo(() => formSchema(t), [t]);

    const save = async (v: FormValues) => {
        setProblem(undefined);
        const parsed = plateBatchReceiveSchema.safeParse({
            reference: v.reference.trim(),
            receivedOn: v.receivedOn,
            plates: { series: v.series.trim().toUpperCase(), from: Number(v.from), to: Number(v.to) },
            note: v.note.trim() === '' ? undefined : v.note.trim()
        });
        if (!parsed.success) {
            setProblem(t('vehicles.plateStock.invalid'));
            return;
        }
        try {
            await receive.mutateAsync(parsed.data);
            router.push('/registry/plate-stock');
        } catch (error) {
            setProblem(getApiErrorMessage(error, t('vehicles.plateStock.receiveFailed')));
        }
    };

    const form = useZodForm({
        schema,
        defaultValues: { reference: '', receivedOn: '', series: '', from: '', to: '', note: '' },
        onSubmit: (v) => save(v)
    });

    return (
        <div className="flex max-w-3xl flex-col gap-6" data-screen="plate-receive">
            <PageHeader title={t('vehicles.plateStock.receive')} description={t('vehicles.plateStock.receiveIntro')} />
            <ZodForm form={form} className="flex flex-col gap-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <form.AppField name="reference">
                        {(f) => <f.TextField label={t('vehicles.plateStock.field.reference')} autoComplete="off" />}
                    </form.AppField>
                    <form.Field name="receivedOn">
                        {(field) => (
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="receivedOn">{t('vehicles.plateStock.field.receivedOn')}</Label>
                                <EthiopianDatePicker
                                    id="receivedOn"
                                    value={field.state.value || null}
                                    onChange={(v) => field.handleChange(v ?? '')}
                                    language={language === 'en' ? 'en' : 'am'}
                                    max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(
                                        new Date()
                                    )}
                                    labels={{
                                        placeholder: t('vehicles.plateStock.pickDate'),
                                        previousMonth: t('vehicles.plateStock.previousMonth'),
                                        nextMonth: t('vehicles.plateStock.nextMonth'),
                                        clear: t('vehicles.plateStock.clear'),
                                        month: t('vehicles.plateStock.month'),
                                        year: t('vehicles.plateStock.year')
                                    }}
                                />
                                {calendar === 'gregorian' && field.state.value && (
                                    <span className="text-muted-foreground text-xs">{field.state.value}</span>
                                )}
                            </div>
                        )}
                    </form.Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                    <form.AppField name="series">
                        {(f) => (
                            <f.TextField
                                label={t('vehicles.plateStock.field.series')}
                                description={t('vehicles.plateStock.seriesHint')}
                                maxLength={3}
                                autoComplete="off"
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="from">
                        {(f) => <f.TextField label={t('vehicles.plateStock.field.from')} inputMode="numeric" />}
                    </form.AppField>
                    <form.AppField name="to">
                        {(f) => <f.TextField label={t('vehicles.plateStock.field.to')} inputMode="numeric" />}
                    </form.AppField>
                </div>
                <form.AppField name="note">
                    {(f) => <f.TextField label={t('vehicles.plateStock.field.note')} />}
                </form.AppField>

                {problem && (
                    <Alert variant="destructive">
                        <AlertDescription>{problem}</AlertDescription>
                    </Alert>
                )}
                <div className="flex gap-2">
                    <form.AppForm>
                        <form.SubmitButton>{t('vehicles.plateStock.receiveSubmit')}</form.SubmitButton>
                    </form.AppForm>
                    <Button type="button" variant="ghost" onClick={() => router.back()}>
                        {t('vehicles.plateStock.cancel')}
                    </Button>
                </div>
            </ZodForm>
        </div>
    );
}
