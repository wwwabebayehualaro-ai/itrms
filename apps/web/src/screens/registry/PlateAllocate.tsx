'use client';

/**
 * Allocating plates to an office directly below the active one (task 1.2a): a run of one series. The office below takes
 * them into its stock when it accepts the allocation.
 */
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { plateAllocationSchema } from '@itrms/vehicles/contracts';
import { Alert, AlertDescription, Button, PageHeader, Skeleton, useZodForm, ZodForm } from '@itrms/ui';
import { z } from 'zod';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useAllocatePlates, useStockSummary } from '@/lib/plate-stock';
import { useText } from '@/lib/preferences';

function formSchema(t: (key: string) => string) {
    const whole = (v: string) => /^\d{1,4}$/.test(v.trim()) && Number(v) >= 1;
    return z.object({
        toUnit: z.string().refine((v) => v !== '', t('vehicles.plateStock.required')),
        series: z.string().refine((v) => /^[A-Za-z]{3}$/.test(v.trim()), t('vehicles.plateStock.seriesHint')),
        from: z.string().refine(whole, t('vehicles.plateStock.serialHint')),
        to: z.string().refine(whole, t('vehicles.plateStock.serialHint')),
        note: z.string().max(500)
    });
}
type FormValues = z.infer<ReturnType<typeof formSchema>>;

export function PlateAllocate() {
    const { t, text } = useText();
    const router = useRouter();
    const summary = useStockSummary();
    const allocate = useAllocatePlates();
    const [problem, setProblem] = useState<string>();
    const schema = useMemo(() => formSchema(t), [t]);

    const save = async (v: FormValues) => {
        setProblem(undefined);
        const parsed = plateAllocationSchema.safeParse({
            toUnitId: v.toUnit,
            plates: { series: v.series.trim().toUpperCase(), from: Number(v.from), to: Number(v.to) },
            note: v.note.trim() === '' ? undefined : v.note.trim()
        });
        if (!parsed.success) {
            setProblem(t('vehicles.plateStock.invalid'));
            return;
        }
        try {
            await allocate.mutateAsync(parsed.data);
            router.push('/registry/plate-stock');
        } catch (error) {
            setProblem(getApiErrorMessage(error, t('vehicles.plateStock.allocateFailed')));
        }
    };

    const form = useZodForm({
        schema,
        defaultValues: { toUnit: '', series: '', from: '', to: '', note: '' },
        onSubmit: (v) => save(v)
    });

    if (summary.isPending) return <Skeleton className="h-48 w-full" />;
    const options = (summary.data?.children ?? []).map((row) => ({
        value: row.unit.id,
        label: text({ am: '', en: '', ...row.unit.name })
    }));

    return (
        <div className="flex max-w-3xl flex-col gap-6" data-screen="plate-allocate">
            <PageHeader
                title={t('vehicles.plateStock.allocate')}
                description={t('vehicles.plateStock.allocateIntro')}
            />
            {summary.error && (
                <Alert variant="destructive">
                    <AlertDescription>
                        {getApiErrorMessage(summary.error, t('vehicles.plateStock.loadFailed'))}
                    </AlertDescription>
                </Alert>
            )}
            <ZodForm form={form} className="flex flex-col gap-6">
                <form.AppField name="toUnit">
                    {(f) => (
                        <f.SelectField
                            label={t('vehicles.plateStock.field.toUnit')}
                            placeholder={t('vehicles.plateStock.choose')}
                            options={options}
                        />
                    )}
                </form.AppField>
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
                        <form.SubmitButton>{t('vehicles.plateStock.allocateSubmit')}</form.SubmitButton>
                    </form.AppForm>
                    <Button type="button" variant="ghost" onClick={() => router.back()}>
                        {t('vehicles.plateStock.cancel')}
                    </Button>
                </div>
            </ZodForm>
        </div>
    );
}
