'use client';

/**
 * A payment order (task 0.22b, ADR-0042): what the case's fee is made of, and at the office's till the payment (the
 * whole total, by cash or a bank deposit slip) that issues the receipt. The amount is typed again by the cashier and the
 * server compares it with the total. At an office that issues pad receipts the pad's series and serial are entered too.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import { addisDate } from '@itrms/ethiopian-calendar';
import {
    Button,
    DescriptionList,
    EmptyState,
    EthiopianDatePicker,
    Field,
    FieldError,
    FieldLabel,
    MoneyInput,
    PageHeader,
    RadioGroup,
    RadioGroupItem,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useZodForm,
    ZodForm,
    type Tone
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import {
    useBanks,
    usePaymentOrder,
    useRecordPayment,
    type FeeLine,
    type PaymentInput,
    type PaymentOrderOut
} from '@/lib/fees';
import { formatDay, formatMoney, formatMoment } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { ReversalDialog } from './ReversalDialog';

const ORDER_TONE: Record<PaymentOrderOut['state'], Tone> = { open: 'progress', settled: 'success', cancelled: 'muted' };

export function PaymentOrderPage({ id }: { id: string }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const order = usePaymentOrder(id);

    if (order.isPending) return <Skeleton className="h-64 w-full" />;
    if (order.error || !order.data)
        return (
            <EmptyState
                variant="error"
                title={t('fees.order.notFound')}
                description={getApiErrorMessage(order.error)}
            />
        );
    const o = order.data;
    return (
        <div className="flex flex-col gap-6" data-screen="payment-order" data-order={o.id} data-state={o.state}>
            <Link href="/cashier" className="flex w-fit items-center gap-2 text-sm text-primary hover:underline">
                <ArrowLeft className="size-4" />
                {t('fees.nav.cashier')}
            </Link>
            <PageHeader
                title={t('fees.order.title', { number: String(o.caseNumber) })}
                description={text(o.serviceName)}
                actions={
                    <div className="flex items-center gap-2">
                        {o.demo && <StatusBadge value="demo" tone="info" label={t('fees.order.demo')} />}
                        {o.overdue && o.state === 'open' && (
                            <StatusBadge value="overdue" tone="danger" label={t('fees.order.overdue')} />
                        )}
                        <StatusBadge
                            value={o.state}
                            tone={ORDER_TONE[o.state]}
                            label={t(`fees.order.state.${o.state}`)}
                        />
                    </div>
                }
            />
            <DescriptionList
                items={[
                    { term: t('fees.order.office'), value: text(o.unit.name) },
                    { term: t('fees.order.dueOn'), value: formatDay(o.dueOn, { language, calendar }) },
                    { term: t('fees.order.createdAt'), value: formatMoment(o.createdAt, { language, calendar }) },
                    {
                        term: t('fees.order.case'),
                        value: (
                            <Link href={`/cases/${o.caseId}`} className="text-primary hover:underline">
                                {t('workflow.case.number', { number: String(o.caseNumber) })}
                            </Link>
                        )
                    }
                ]}
            />
            <Lines lines={o.lines} total={o.totalSantim} />
            {o.state === 'open' &&
                (o.collection === 'cashier' ? (
                    <PaymentForm order={o} />
                ) : (
                    <p className="text-muted-foreground text-sm" role="note">
                        {t('fees.order.collectedElsewhere')}
                    </p>
                ))}
            {o.state === 'cancelled' && (
                <p className="text-muted-foreground text-sm" role="note">
                    {t(`fees.order.cancelled.${o.cancelReason ?? 'reassessed'}`)}
                </p>
            )}
            <Payments order={o} />
        </div>
    );
}

function Lines({ lines, total }: { lines: FeeLine[]; total: string }) {
    const { t, text, language } = useText();
    return (
        <section className="flex flex-col gap-2" data-lines>
            <h2 className="font-medium">{t('fees.order.lines')}</h2>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('fees.order.col.item')}</TableHead>
                        <TableHead className="text-right">{t('fees.order.col.quantity')}</TableHead>
                        <TableHead className="text-right">{t('fees.order.col.amount')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {lines.map((line) => (
                        <TableRow key={line.key}>
                            <TableCell>{text(line.label)}</TableCell>
                            <TableCell className="text-right tabular-nums">{line.quantity ?? ''}</TableCell>
                            <TableCell className="text-right tabular-nums">
                                {formatMoney(line.amountSantim, language)}
                            </TableCell>
                        </TableRow>
                    ))}
                    <TableRow>
                        <TableCell className="font-semibold" colSpan={2}>
                            {t('fees.order.total')}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums" data-total={total}>
                            {formatMoney(total, language)}
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </section>
    );
}

/** Today's date in Addis Ababa (YYYY-MM-DD): a deposit slip is not dated after it. */
const todayInAddis = () => {
    const { year, month, day } = addisDate(new Date());
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

function PaymentForm({ order }: { order: PaymentOrderOut }) {
    const { t, text, language } = useText();
    const router = useRouter();
    const record = useRecordPayment(order.id);
    const banks = useBanks();
    const pad = order.receiptSource === 'pad';

    const schema = z
        .object({
            method: z.enum(['cash', 'bank_slip']),
            amountSantim: z.string().regex(/^[1-9]\d{0,17}$/, t('fees.payment.invalid.amount')),
            receivedFrom: z
                .string()
                .trim()
                .min(2, t('fees.payment.invalid.receivedFrom'))
                .max(200, t('fees.payment.invalid.receivedFrom')),
            bank: z.string(),
            reference: z.string(),
            paidOn: z.string(),
            padSeries: z.string(),
            padSerial: z.string()
        })
        .superRefine((v, ctx) => {
            const need = (path: string, ok: boolean, message: string) => {
                if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
            };
            if (v.method === 'bank_slip') {
                need('bank', /^[A-Z0-9]{2,12}$/.test(v.bank.trim().toUpperCase()), t('fees.payment.invalid.bank'));
                need(
                    'reference',
                    v.reference.trim().length >= 3 && v.reference.trim().length <= 40,
                    t('fees.payment.invalid.reference')
                );
                need('paidOn', /^\d{4}-\d{2}-\d{2}$/.test(v.paidOn), t('fees.payment.invalid.slipDate'));
                need('paidOn', v.paidOn <= todayInAddis(), t('fees.payment.slipFuture'));
            }
            if (pad) {
                need(
                    'padSeries',
                    /^[A-Z0-9-]{1,16}$/.test(v.padSeries.trim().toUpperCase()),
                    t('fees.payment.invalid.padSeries')
                );
                need('padSerial', /^\d{1,10}$/.test(v.padSerial.trim()), t('fees.payment.invalid.padSerial'));
            }
        });

    const form = useZodForm({
        schema,
        defaultValues: {
            method: 'cash' as 'cash' | 'bank_slip',
            amountSantim: '',
            receivedFrom: '',
            bank: '',
            reference: '',
            paidOn: '',
            padSeries: '',
            padSerial: ''
        },
        onSubmit: async (v) => {
            const input: PaymentInput = {
                method: v.method,
                amountSantim: v.amountSantim,
                receivedFrom: v.receivedFrom,
                ...(v.method === 'bank_slip'
                    ? {
                          bankSlip: {
                              bank: v.bank.trim().toUpperCase(),
                              reference: v.reference.trim(),
                              paidOn: v.paidOn
                          }
                      }
                    : {}),
                ...(pad ? { pad: { series: v.padSeries.trim().toUpperCase(), serial: v.padSerial.trim() } } : {})
            };
            const done = await record.mutateAsync(input);
            router.push(`/receipts/${done.receipt.id}`);
        }
    });

    return (
        <section className="flex flex-col gap-3 rounded-md border p-4" data-payment-form>
            <h2 className="font-medium">{t('fees.payment.title')}</h2>
            <p className="text-muted-foreground text-sm">
                {t('fees.payment.intro', { total: formatMoney(order.totalSantim, language) })}
            </p>
            <ZodForm form={form}>
                <form.AppField name="method">
                    {(field) => (
                        <Field>
                            <FieldLabel id="payment-method-label">{t('fees.payment.methodLabel')}</FieldLabel>
                            <RadioGroup
                                aria-labelledby="payment-method-label"
                                className="flex gap-6"
                                value={field.state.value}
                                onValueChange={(v) => field.handleChange(v === 'bank_slip' ? 'bank_slip' : 'cash')}
                            >
                                {(['cash', 'bank_slip'] as const).map((m) => (
                                    <div key={m} className="flex items-center gap-2">
                                        <RadioGroupItem id={`method-${m}`} value={m} data-method={m} />
                                        <FieldLabel htmlFor={`method-${m}`}>{t(`fees.payment.method.${m}`)}</FieldLabel>
                                    </div>
                                ))}
                            </RadioGroup>
                        </Field>
                    )}
                </form.AppField>
                <form.AppField name="amountSantim">
                    {(field) => (
                        <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                            <FieldLabel htmlFor="payment-amount">{t('fees.payment.amount')}</FieldLabel>
                            <MoneyInput
                                id="payment-amount"
                                unit={language === 'am' ? 'ብር' : 'Birr'}
                                refusedMessage={t('common.money.refused')}
                                value={field.state.value === '' ? null : BigInt(field.state.value)}
                                onValueChange={(santim) => field.handleChange(santim === null ? '' : santim.toString())}
                                onBlur={field.handleBlur}
                            />
                            <p className="text-muted-foreground text-xs">{t('fees.payment.amountHint')}</p>
                            <ErrorsOf errors={field.state.meta.errors} touched={field.state.meta.isTouched} />
                        </Field>
                    )}
                </form.AppField>
                <form.AppField name="receivedFrom">
                    {(f) => <f.TextField label={t('fees.payment.receivedFrom')} maxLength={200} autoComplete="off" />}
                </form.AppField>
                <form.Subscribe selector={(s) => s.values.method}>
                    {(method) =>
                        method === 'bank_slip' && (
                            <div className="grid gap-4 sm:grid-cols-3" data-bank-slip>
                                <form.AppField name="bank">
                                    {(f) =>
                                        banks ? (
                                            <f.SelectField
                                                label={t('fees.payment.bank')}
                                                placeholder={t('fees.payment.bankPlaceholder')}
                                                options={banks.map((b) => ({ value: b.code, label: text(b.name) }))}
                                            />
                                        ) : (
                                            <f.TextField
                                                label={t('fees.payment.bankCode')}
                                                description={t('fees.payment.bankCodeHint')}
                                                maxLength={12}
                                            />
                                        )
                                    }
                                </form.AppField>
                                <form.AppField name="reference">
                                    {(f) => <f.TextField label={t('fees.payment.reference')} maxLength={40} />}
                                </form.AppField>
                                <form.AppField name="paidOn">
                                    {(field) => (
                                        <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                                            <FieldLabel htmlFor="payment-paid-on">
                                                {t('fees.payment.slipDate')}
                                            </FieldLabel>
                                            <EthiopianDatePicker
                                                id="payment-paid-on"
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
                                            <ErrorsOf
                                                errors={field.state.meta.errors}
                                                touched={field.state.meta.isTouched}
                                            />
                                        </Field>
                                    )}
                                </form.AppField>
                            </div>
                        )
                    }
                </form.Subscribe>
                {pad && (
                    <div className="grid gap-4 sm:grid-cols-2" data-pad>
                        <form.AppField name="padSeries">
                            {(f) => (
                                <f.TextField
                                    label={t('fees.payment.padSeries')}
                                    description={t('fees.payment.padHint')}
                                    maxLength={16}
                                />
                            )}
                        </form.AppField>
                        <form.AppField name="padSerial">
                            {(f) => (
                                <f.TextField label={t('fees.payment.padSerial')} inputMode="numeric" maxLength={10} />
                            )}
                        </form.AppField>
                    </div>
                )}
                <div className="flex justify-end">
                    <form.AppForm>
                        <form.SubmitButton data-action="record-payment">{t('fees.payment.submit')}</form.SubmitButton>
                    </form.AppForm>
                </div>
            </ZodForm>
        </section>
    );
}

/** The messages of a field's Zod issues (once each), after the person has left it. */
function ErrorsOf({ errors, touched }: { errors: unknown[]; touched: boolean }) {
    if (!touched) return null;
    const messages = [
        ...new Set(
            errors
                .map((e) =>
                    typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e ? String(e.message) : ''
                )
                .filter(Boolean)
        )
    ];
    return messages.length > 0 ? <FieldError>{messages.join(' ')}</FieldError> : null;
}

function Payments({ order }: { order: PaymentOrderOut }) {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const mayRequest = useCan('receipt-reversal:request');
    const [reversing, setReversing] = useState<{ id: string; number: string } | null>(null);
    if (order.payments.length === 0)
        return (
            <p className="text-muted-foreground text-sm" data-payments-empty>
                {t('fees.order.noPayments')}
            </p>
        );
    return (
        <section className="flex flex-col gap-2" data-payments>
            <h2 className="font-medium">{t('fees.order.payments')}</h2>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('fees.order.col.receipt')}</TableHead>
                        <TableHead>{t('fees.order.col.method')}</TableHead>
                        <TableHead className="text-right">{t('fees.order.col.amount')}</TableHead>
                        <TableHead>{t('fees.order.col.receivedFrom')}</TableHead>
                        <TableHead>{t('fees.order.col.receivedAt')}</TableHead>
                        <TableHead className="text-right">{t('fees.order.col.actions')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {order.payments.map((p) => {
                        const receiptId = p.receiptId;
                        const receiptNumber = p.receiptNumber;
                        const waiting = order.reversals.some(
                            (r) => r.receiptId === receiptId && r.state === 'requested'
                        );
                        return (
                            <TableRow key={p.id} data-payment={p.id} data-voided={p.voided}>
                                <TableCell>
                                    {receiptId && receiptNumber ? (
                                        <Link href={`/receipts/${receiptId}`} className="text-primary hover:underline">
                                            {receiptNumber}
                                        </Link>
                                    ) : (
                                        '—'
                                    )}
                                    {p.voided && (
                                        <div>
                                            <StatusBadge
                                                value="reversed"
                                                tone="danger"
                                                label={t('fees.receipt.reversed')}
                                            />
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell>{t(`fees.payment.method.${p.method}`)}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {formatMoney(p.amountSantim, language)}
                                </TableCell>
                                <TableCell>{p.receivedFrom}</TableCell>
                                <TableCell>{formatMoment(p.receivedAt, { language, calendar })}</TableCell>
                                <TableCell className="text-right">
                                    {mayRequest &&
                                        receiptId &&
                                        receiptNumber &&
                                        !p.voided &&
                                        (waiting ? (
                                            <span className="text-muted-foreground text-xs">
                                                {t('fees.reversal.waiting')}
                                            </span>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                data-action="request-reversal"
                                                onClick={() => setReversing({ id: receiptId, number: receiptNumber })}
                                            >
                                                {t('fees.reversal.request')}
                                            </Button>
                                        ))}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
            {reversing && (
                <ReversalDialog
                    receiptId={reversing.id}
                    receiptNumber={reversing.number}
                    onClose={() => setReversing(null)}
                />
            )}
        </section>
    );
}
