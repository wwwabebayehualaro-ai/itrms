'use client';

/**
 * One remittance (task 1.12d, ADR-0063 §5): its totals, the lines by finance account (the ones booked to the default account
 * are flagged), the cashier days it covers, its document, and the bank deposit slip: recorded once, for the amount due.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import {
    EmptyState,
    EthiopianDatePicker,
    Field,
    FieldLabel,
    MoneyInput,
    PageHeader,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useNotify,
    useZodForm,
    ZodForm
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { useCan } from '@/lib/auth/authHooks';
import { useIssuedDocuments } from '@/lib/documents';
import { useBanks, useDepositRemittance, useRemittance, type RemittanceDetail } from '@/lib/fees';
import { formatDay, formatMoment, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { OpenPdfButton } from '../documents/CaseDocuments';
import { ErrorsOf, todayInAddis } from './form-bits';
import { Figure } from './RemittanceList';

export function RemittancePage({ id }: { id: string }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const remittance = useRemittance(id);
    const activeUnit = useAuthStore((s) => s.workspace?.activeUnit.id);
    const mayDeposit = useCan('remittance:deposit');
    // the document issued for it, once the worker has made its PDF
    const documents = useIssuedDocuments({ subjectId: id }, useCan('issued-document:read'));
    const pdf = documents.data?.items[0];

    if (remittance.isPending) return <Skeleton className="h-64 w-full" />;
    if (remittance.error || !remittance.data)
        return (
            <EmptyState
                variant="error"
                title={t('fees.remittance.notFound')}
                description={getApiErrorMessage(remittance.error)}
            />
        );
    const r = remittance.data;
    return (
        <div className="flex flex-col gap-6" data-screen="remittance" data-remittance={r.id} data-state={r.state}>
            <Link
                href="/finance/remittances"
                className="flex w-fit items-center gap-2 text-sm text-primary hover:underline"
            >
                <ArrowLeft className="size-4" />
                {t('fees.remittance.back')}
            </Link>
            <PageHeader
                title={t('fees.remittance.heading', { number: r.number })}
                description={`${formatDay(r.periodFrom, { language, calendar })} – ${formatDay(r.periodTo, { language, calendar })}`}
                actions={
                    <div className="flex items-center gap-2">
                        <StatusBadge
                            value={r.state}
                            tone={r.state === 'deposited' ? 'success' : 'progress'}
                            label={t(`fees.remittance.state.${r.state}`)}
                        />
                        {pdf?.state === 'rendered' && (
                            <OpenPdfButton document={pdf} label={t('fees.remittance.download')} />
                        )}
                    </div>
                }
            />
            {r.demo && (
                <p className="font-medium" data-demo>
                    {t('fees.remittance.demo')}
                </p>
            )}
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2" data-remittance-totals>
                <Figure label={t('fees.remittance.total')} value={r.revenueTotalSantim} />
                <Figure label={t('fees.remittance.cash')} value={r.cashSantim} />
                <Figure label={t('fees.remittance.bankSlip')} value={r.bankSlipSantim} />
                <Figure label={t('fees.remittance.reversals')} value={r.reversalSantim} />
                <Figure label={t('fees.remittance.difference')} value={r.differenceSantim} />
                <Figure label={t('fees.remittance.depositDue')} value={r.depositDueSantim} strong />
            </dl>

            <section className="flex flex-col gap-2">
                <h2 className="font-medium">{t('fees.remittance.accounts')}</h2>
                <Table data-remittance-groups>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('fees.remittance.col.account')}</TableHead>
                            <TableHead>{t('fees.remittance.col.category')}</TableHead>
                            <TableHead>{t('fees.remittance.col.accountName')}</TableHead>
                            <TableHead className="text-right">{t('fees.remittance.col.receipts')}</TableHead>
                            <TableHead className="text-right">{t('fees.remittance.col.reversals')}</TableHead>
                            <TableHead className="text-right">{t('fees.remittance.col.net')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {r.groups.map((g) => (
                            <TableRow key={`${g.accountCode}/${g.budgetCategory}`} data-group={g.accountCode}>
                                <TableCell>{g.accountCode}</TableCell>
                                <TableCell>{g.budgetCategory}</TableCell>
                                <TableCell>
                                    {text(g.accountName)}
                                    {g.mappedByDefault && (
                                        <span className="ml-2" data-by-default>
                                            <StatusBadge
                                                value="default"
                                                tone="warning"
                                                label={t('fees.remittance.mappedByDefault')}
                                            />
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatMoney(g.receiptSantim, language)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatMoney(g.reversalSantim, language)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatMoney(g.totalSantim, language)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </section>

            <section className="flex flex-col gap-2">
                <h2 className="font-medium">{t('fees.remittance.sessions')}</h2>
                <Table data-remittance-sessions>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('fees.remittance.col.day')}</TableHead>
                            <TableHead className="text-right">{t('fees.remittance.col.float')}</TableHead>
                            <TableHead className="text-right">{t('fees.remittance.col.expected')}</TableHead>
                            <TableHead className="text-right">{t('fees.remittance.col.counted')}</TableHead>
                            <TableHead className="text-right">{t('fees.remittance.col.sessionDifference')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {r.sessions.map((s) => (
                            <TableRow key={s.id}>
                                <TableCell>
                                    <Link href={`/cashier/sessions/${s.id}`} className="text-primary hover:underline">
                                        {formatDay(s.businessDay, { language, calendar })}
                                    </Link>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatMoney(s.openingFloatSantim, language)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatMoney(s.expectedCashSantim, language)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatMoney(s.countedSantim, language)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatMoney(s.differenceSantim, language)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </section>

            {r.deposit ? (
                <section className="flex flex-col gap-1 rounded-md border p-4" data-deposit>
                    <h2 className="font-medium">{t('fees.remittance.deposit.recorded')}</h2>
                    <p className="text-sm">
                        {t('fees.remittance.deposit.summary', {
                            bank: r.deposit.bank,
                            reference: r.deposit.reference,
                            amount: formatMoney(r.deposit.amountSantim, language),
                            day: formatDay(r.deposit.depositedOn, { language, calendar })
                        })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                        {formatMoment(r.deposit.depositedAt, { language, calendar })}
                    </p>
                </section>
            ) : (
                mayDeposit && r.unit.id === activeUnit && <DepositForm remittance={r} />
            )}
        </div>
    );
}

function DepositForm({ remittance }: { remittance: RemittanceDetail }) {
    const { t, text, language } = useText();
    const notify = useNotify();
    const deposit = useDepositRemittance(remittance.id);
    const banks = useBanks();
    const schema = z.object({
        bank: z.string().regex(/^[A-Z0-9]{2,12}$/, t('fees.remittance.deposit.invalid.bank')),
        reference: z
            .string()
            .trim()
            .min(3, t('fees.remittance.deposit.invalid.reference'))
            .max(40, t('fees.remittance.deposit.invalid.reference')),
        depositedOn: z.string().min(1, t('fees.remittance.deposit.invalid.depositedOn')),
        amountSantim: z.string().regex(/^(0|[1-9]\d{0,16})$/, t('fees.remittance.deposit.invalid.amount'))
    });
    const form = useZodForm({
        schema,
        defaultValues: { bank: '', reference: '', depositedOn: '', amountSantim: '' },
        onSubmit: async (v) => {
            await deposit.mutateAsync(v);
            notify.success(t('fees.remittance.deposit.saved'));
        }
    });
    return (
        <section className="flex flex-col gap-3 rounded-md border p-4" data-deposit-form>
            <h2 className="font-medium">{t('fees.remittance.deposit.title')}</h2>
            <p className="text-muted-foreground text-sm">
                {t('fees.remittance.deposit.intro', { due: formatMoney(remittance.depositDueSantim, language) })}
            </p>
            <ZodForm form={form}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <form.AppField name="bank">
                        {(f) =>
                            banks ? (
                                <f.SelectField
                                    label={t('fees.remittance.deposit.bank')}
                                    placeholder={t('fees.remittance.deposit.bankPlaceholder')}
                                    options={banks.map((b) => ({ value: b.code, label: text(b.name) }))}
                                />
                            ) : (
                                <f.TextField label={t('fees.remittance.deposit.bank')} maxLength={12} />
                            )
                        }
                    </form.AppField>
                    <form.AppField name="reference">
                        {(f) => (
                            <f.TextField
                                label={t('fees.remittance.deposit.reference')}
                                maxLength={40}
                                autoComplete="off"
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="depositedOn">
                        {(field) => (
                            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                                <FieldLabel htmlFor="deposit-on">{t('fees.remittance.deposit.depositedOn')}</FieldLabel>
                                <EthiopianDatePicker
                                    id="deposit-on"
                                    value={field.state.value || null}
                                    onChange={(v) => field.handleChange(v ?? '')}
                                    onOpenChange={(open) => !open && field.handleBlur()}
                                    language={language === 'en' ? 'en' : 'am'}
                                    max={todayInAddis()}
                                    labels={{
                                        placeholder: t('fees.payment.pickDate'),
                                        previousMonth: t('fees.payment.previousMonth'),
                                        nextMonth: t('fees.payment.nextMonth'),
                                        clear: t('fees.payment.clear'),
                                        month: t('fees.payment.month'),
                                        year: t('fees.payment.year')
                                    }}
                                />
                                <ErrorsOf errors={field.state.meta.errors} touched={field.state.meta.isTouched} />
                            </Field>
                        )}
                    </form.AppField>
                    <form.AppField name="amountSantim">
                        {(field) => (
                            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                                <FieldLabel htmlFor="deposit-amount">{t('fees.remittance.deposit.amount')}</FieldLabel>
                                <MoneyInput
                                    id="deposit-amount"
                                    unit={t('common.money.unit')}
                                    refusedMessage={t('common.money.refused')}
                                    value={field.state.value === '' ? null : BigInt(field.state.value)}
                                    onValueChange={(santim) =>
                                        field.handleChange(santim === null ? '' : santim.toString())
                                    }
                                    onBlur={field.handleBlur}
                                />
                                <ErrorsOf errors={field.state.meta.errors} touched={field.state.meta.isTouched} />
                            </Field>
                        )}
                    </form.AppField>
                </div>
                {deposit.error && (
                    <p className="text-destructive text-sm" role="alert">
                        {getApiErrorMessage(deposit.error)}
                    </p>
                )}
                <div className="flex justify-end">
                    <form.AppForm>
                        <form.SubmitButton data-action="record-deposit">
                            {t('fees.remittance.deposit.submit')}
                        </form.SubmitButton>
                    </form.AppForm>
                </div>
            </ZodForm>
        </section>
    );
}
