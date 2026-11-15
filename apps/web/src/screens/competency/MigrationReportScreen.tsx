'use client';

/**
 * The reconciliation report of the paper-record migration (ADR-0054 §4, task 1.13h): per office and plate code, the paper files
 * the zone counted on the shelves, the vehicles verified onto the register and what is missing; what awaits its second person; and
 * the share migrated. The zone sets the counts for the offices below it, never for its own.
 */
import { useState } from 'react';
import { z } from 'zod';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    EmptyState,
    EthiopianDatePicker,
    Field,
    FieldLabel,
    PageHeader,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Button,
    useNotify,
    useZodForm,
    ZodForm
} from '@itrms/ui';
import { MAX_PAPER_COUNT, type ReconciliationCode, type ReconciliationOffice } from '@itrms/competency/contracts';

import { getApiErrorMessage } from '@/lib/api/errors';
import { formatDay } from '@/lib/format';
import { useMigrationReport, useSetPaperCount } from '@/lib/migration-report';
import { usePreferences, useText } from '@/lib/preferences';
import { ErrorsOf, todayInAddis } from '@/screens/fees/form-bits';

/** A share as a percentage with one decimal; none without a paper count. */
const percent = (share: number | null): string => (share === null ? '—' : `${(share * 100).toFixed(1)}%`);
const figure = (n: number | null): string => (n === null ? '—' : String(n));

interface Target {
    office: ReconciliationOffice;
    code: ReconciliationCode;
}

function PaperCountForm({ target, onDone }: { target: Target; onDone: () => void }) {
    const { t, language } = useText();
    const notify = useNotify();
    const set = useSetPaperCount();
    const schema = z.object({
        count: z
            .string()
            .regex(/^\d{1,8}$/, t('competency.report.invalid.count'))
            .refine((v) => Number(v) <= MAX_PAPER_COUNT, t('competency.report.invalid.count')),
        countedOn: z.string().min(1, t('competency.report.invalid.countedOn'))
    });
    const form = useZodForm({
        schema,
        defaultValues: {
            count: target.code.paper ? String(target.code.paper.count) : '',
            countedOn: target.code.paper?.countedOn ?? todayInAddis()
        },
        onSubmit: async (v) => {
            await set.mutateAsync({
                count: {
                    unitId: target.office.unit.id,
                    plateCode: target.code.plateCode,
                    count: Number(v.count),
                    countedOn: v.countedOn
                },
                version: target.code.paper?.version ?? null
            });
            notify.success(t('competency.report.saved'));
            onDone();
        }
    });
    return (
        <ZodForm form={form}>
            <form.AppField name="count">
                {(f) => (
                    <f.TextField
                        label={t('competency.report.count')}
                        inputMode="numeric"
                        maxLength={8}
                        autoComplete="off"
                        data-field="count"
                    />
                )}
            </form.AppField>
            <form.AppField name="countedOn">
                {(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                        <FieldLabel htmlFor="paper-counted-on">{t('competency.report.countedOn')}</FieldLabel>
                        <EthiopianDatePicker
                            id="paper-counted-on"
                            value={field.state.value || null}
                            onChange={(v) => field.handleChange(v ?? '')}
                            onOpenChange={(open) => !open && field.handleBlur()}
                            language={language === 'en' ? 'en' : 'am'}
                            max={todayInAddis()}
                            labels={{
                                placeholder: t('competency.report.picker.placeholder'),
                                previousMonth: t('competency.report.picker.previousMonth'),
                                nextMonth: t('competency.report.picker.nextMonth'),
                                clear: t('competency.report.picker.clear'),
                                month: t('competency.report.picker.month'),
                                year: t('competency.report.picker.year')
                            }}
                        />
                        <ErrorsOf errors={field.state.meta.errors} touched={field.state.meta.isTouched} />
                    </Field>
                )}
            </form.AppField>
            <div className="flex justify-end">
                <form.AppForm>
                    <form.SubmitButton data-action="save-paper-count">{t('competency.report.save')}</form.SubmitButton>
                </form.AppForm>
            </div>
        </ZodForm>
    );
}

export function MigrationReport() {
    const { t, text, language } = useText();
    const { calendar } = usePreferences();
    const report = useMigrationReport();
    const [target, setTarget] = useState<Target | null>(null);
    if (report.isPending) return <Skeleton className="h-40 w-full" />;
    if (report.error)
        return (
            <EmptyState
                variant="error"
                title={t('competency.report.error')}
                description={getApiErrorMessage(report.error)}
            />
        );
    const { offices, total, mayCount, ownUnitId } = report.data;
    return (
        <div className="flex flex-col gap-6" data-screen="migration-report">
            <PageHeader title={t('competency.report.title')} description={t('competency.report.intro')} />
            {offices.length === 0 ? (
                <EmptyState title={t('competency.report.empty')} />
            ) : (
                <>
                    {offices.map((o) => {
                        const editable = mayCount && o.unit.id !== ownUnitId;
                        return (
                            <section key={o.unit.id} className="flex flex-col gap-2" data-office={o.unit.code}>
                                <h2 className="text-lg font-medium">{text({ am: '', en: '', ...o.unit.name })}</h2>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t('competency.report.code')}</TableHead>
                                            <TableHead>{t('competency.report.paper')}</TableHead>
                                            <TableHead>{t('competency.report.verified')}</TableHead>
                                            <TableHead>{t('competency.report.missing')}</TableHead>
                                            {editable && <TableHead />}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {o.codes.map((c) => (
                                            <TableRow key={c.plateCode} data-code={c.plateCode}>
                                                <TableCell>{t(`competency.report.codes.${c.plateCode}`)}</TableCell>
                                                <TableCell data-cell="paper">
                                                    {figure(c.paper?.count ?? null)}
                                                    {c.paper && (
                                                        <span className="text-muted-foreground ms-2 text-xs">
                                                            {formatDay(c.paper.countedOn, { language, calendar })}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell data-cell="verified">{c.verified}</TableCell>
                                                <TableCell data-cell="missing">{figure(c.missing)}</TableCell>
                                                {editable && (
                                                    <TableCell>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            data-action="paper-count"
                                                            onClick={() => setTarget({ office: o, code: c })}
                                                        >
                                                            {t('competency.report.setCount')}
                                                        </Button>
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        ))}
                                        <TableRow data-code="total">
                                            <TableCell className="font-medium">
                                                {t('competency.report.total')}
                                            </TableCell>
                                            <TableCell data-cell="paper">{figure(o.paper)}</TableCell>
                                            <TableCell data-cell="verified">{o.verified}</TableCell>
                                            <TableCell data-cell="missing">{figure(o.missing)}</TableCell>
                                            {editable && <TableCell />}
                                        </TableRow>
                                    </TableBody>
                                </Table>
                                <p className="text-sm" data-awaiting>
                                    {t('competency.report.awaiting', {
                                        captures: String(o.awaiting.captures),
                                        rows: String(o.awaiting.importRows)
                                    })}
                                </p>
                                <p className="text-sm">
                                    {t('competency.report.share')} <span data-share>{percent(o.share)}</span>
                                </p>
                            </section>
                        );
                    })}
                    <section className="flex flex-col gap-1 text-sm" data-total>
                        <h2 className="text-lg font-medium">{t('competency.report.grandTotal')}</h2>
                        <p>
                            {t('competency.report.totals', {
                                paper: figure(total.paper),
                                verified: String(total.verified),
                                missing: figure(total.missing)
                            })}
                        </p>
                        <p>
                            {t('competency.report.awaiting', {
                                captures: String(total.awaiting.captures),
                                rows: String(total.awaiting.importRows)
                            })}
                        </p>
                        <p>
                            {t('competency.report.share')} <span data-share>{percent(total.share)}</span>
                        </p>
                    </section>
                </>
            )}
            <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
                <DialogContent data-paper-count-dialog>
                    <DialogHeader>
                        <DialogTitle>{t('competency.report.dialogTitle')}</DialogTitle>
                        <DialogDescription>
                            {target
                                ? t('competency.report.dialogFor', {
                                      office: text({ am: '', en: '', ...target.office.unit.name }),
                                      code: t(`competency.report.codes.${target.code.plateCode}`)
                                  })
                                : ''}
                        </DialogDescription>
                    </DialogHeader>
                    {target && (
                        <PaperCountForm
                            key={`${target.office.unit.id}-${target.code.plateCode}`}
                            target={target}
                            onDone={() => setTarget(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
