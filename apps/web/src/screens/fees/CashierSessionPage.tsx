'use client';

/**
 * One cashier session and its closing (task 1.12, ADR-0063): what the till should hold, the count (a total, optionally by
 * denomination; a difference needs a note), the counts so far and what is waiting beside them (read only). The cashier
 * counts; another person decides a count with a difference (the closing inbox).
 */
import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import {
    DescriptionList,
    EmptyState,
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
    ZodForm,
    type Tone
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { useCountSession, useSession, type CashierSessionDetail } from '@/lib/fees';
import { formatDay, formatMoney, formatMoment } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { ErrorsOf } from './form-bits';

export const SESSION_TONES: Record<string, Tone> = {
    open: 'info',
    pending_approval: 'warning',
    counting: 'warning',
    closed: 'success'
};

export function CashierSessionPage({ id }: { id: string }) {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const session = useSession(id);

    if (session.isPending) return <Skeleton className="h-60 w-full" />;
    if (session.error)
        return (
            <EmptyState
                variant="error"
                title={t('fees.session.error')}
                description={getApiErrorMessage(session.error)}
            />
        );
    const s = session.data;
    return (
        <div
            className="flex flex-col gap-6"
            data-screen="cashier-session"
            data-state={s.state}
            data-expected={s.expectedCashSantim}
        >
            <Link href="/cashier" className="text-primary inline-flex items-center gap-1 text-sm hover:underline">
                <ArrowLeft className="size-4" aria-hidden />
                {t('fees.session.back')}
            </Link>
            <PageHeader
                title={t('fees.session.page.title', { day: formatDay(s.businessDay, { language, calendar }) })}
                description={t('fees.session.page.intro')}
                status={
                    <StatusBadge
                        value={s.state}
                        tone={SESSION_TONES[s.state] ?? 'neutral'}
                        label={t(`fees.session.state.${s.state}`)}
                    />
                }
            />
            <DescriptionList
                items={[
                    { term: t('fees.session.float'), value: formatMoney(s.openingFloatSantim, language) },
                    { term: t('fees.session.cash'), value: formatMoney(s.cashReceiptsSantim, language) },
                    { term: t('fees.session.expected'), value: formatMoney(s.expectedCashSantim, language) },
                    { term: t('fees.session.bankSlip'), value: formatMoney(s.bankSlipSantim, language) },
                    { term: t('fees.session.receipts'), value: String(s.receiptCount) },
                    { term: t('fees.session.voided'), value: String(s.voidedReceiptCount) },
                    { term: t('fees.session.pendingReversals'), value: String(s.pendingReversals) },
                    { term: t('fees.session.pendingRefs'), value: String(s.pendingExternalRefs) }
                ]}
            />
            {s.receiptLeafClosings.length > 0 && (
                <section className="flex flex-col gap-1 text-sm" data-leaf-closings>
                    <h2 className="font-medium">{t('fees.session.leaves')}</h2>
                    {s.receiptLeafClosings.map((l) => (
                        <p key={l.closedOn} className="text-muted-foreground">
                            {t('fees.session.leavesRow', {
                                day: formatDay(l.closedOn, { language, calendar }),
                                expected: String(l.expected),
                                counted: String(l.counted),
                                missing: String(l.missingCount)
                            })}
                        </p>
                    ))}
                </section>
            )}
            {(s.state === 'open' || s.state === 'counting') && <CountForm session={s} />}
            {s.state === 'pending_approval' && (
                <p className="text-muted-foreground text-sm" data-waiting>
                    {t('fees.session.waiting')}
                </p>
            )}
            {s.counts.length > 0 && (
                <section className="flex flex-col gap-2">
                    <h2 className="font-medium">{t('fees.session.history')}</h2>
                    <Table data-counts>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('fees.session.col.attempt')}</TableHead>
                                <TableHead className="text-right">{t('fees.session.col.counted')}</TableHead>
                                <TableHead className="text-right">{t('fees.session.col.difference')}</TableHead>
                                <TableHead>{t('fees.session.col.state')}</TableHead>
                                <TableHead>{t('fees.session.col.note')}</TableHead>
                                <TableHead>{t('fees.session.col.at')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {s.counts.map((c) => (
                                <TableRow key={c.id} data-count={c.id} data-count-state={c.state}>
                                    <TableCell>{c.attempt}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {formatMoney(c.countedSantim, language)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {formatMoney(c.differenceSantim, language)}
                                    </TableCell>
                                    <TableCell>{t(`fees.session.count.${c.state}`)}</TableCell>
                                    <TableCell className="max-w-xs whitespace-pre-wrap">
                                        {[c.note, c.decisionNote].filter(Boolean).join(' / ')}
                                    </TableCell>
                                    <TableCell>{formatMoment(c.countedAt, { language, calendar })}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </section>
            )}
        </div>
    );
}

const AMOUNT = /^(0|[1-9]\d{0,16})$/;

function CountForm({ session }: { session: CashierSessionDetail }) {
    const { t, language } = useText();
    const notify = useNotify();
    const mayClose = useCan('cashier-session:close');
    const count = useCountSession(session.id);
    // a count by denomination: the server adds it up and must find the total
    const [pieces, setPieces] = useState<Record<number, string>>({});
    const expected = BigInt(session.expectedCashSantim);
    const sum = session.denominations.reduce((acc, v) => acc + BigInt(v) * BigInt(Number(pieces[v]) || 0), 0n);
    const byDenomination = Object.values(pieces).some((n) => n !== '');

    const schema = z
        .object({ countedSantim: z.string().regex(AMOUNT, t('fees.session.invalidTotal')), note: z.string() })
        .superRefine((v, ctx) => {
            if (!AMOUNT.test(v.countedSantim)) return;
            if (BigInt(v.countedSantim) !== expected && v.note.trim().length < 10)
                ctx.addIssue({ code: 'custom', path: ['note'], message: t('fees.session.noteRequired') });
        });
    const form = useZodForm({
        schema,
        defaultValues: { countedSantim: '', note: '' },
        onSubmit: async (v) => {
            const denominations = byDenomination
                ? session.denominations
                      .filter((value) => Number(pieces[value]) > 0)
                      .map((value) => ({ valueSantim: value, count: Number(pieces[value]) }))
                : undefined;
            if (denominations && sum !== BigInt(v.countedSantim)) {
                notify.error(t('fees.session.sumMismatch', { sum: formatMoney(sum, language) }));
                return;
            }
            const done = await count.mutateAsync({
                countedSantim: v.countedSantim,
                ...(denominations ? { denominations } : {}),
                ...(v.note.trim() ? { note: v.note.trim() } : {})
            });
            notify.success(t(done.state === 'closed' ? 'fees.session.closedNow' : 'fees.session.sentForDecision'));
        }
    });
    if (!mayClose) return null;

    return (
        <section className="flex flex-col gap-3 rounded-md border p-4" data-count-form>
            <h2 className="font-medium">{t('fees.session.count.title')}</h2>
            <p className="text-muted-foreground text-sm">
                {t('fees.session.count.intro', { expected: formatMoney(session.expectedCashSantim, language) })}
            </p>
            <ZodForm form={form}>
                <form.AppField name="countedSantim">
                    {(field) => (
                        <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                            <FieldLabel htmlFor="count-total">{t('fees.session.count.total')}</FieldLabel>
                            <MoneyInput
                                id="count-total"
                                unit={t('common.money.unit')}
                                refusedMessage={t('common.money.refused')}
                                value={field.state.value === '' ? null : BigInt(field.state.value)}
                                onValueChange={(santim) => field.handleChange(santim === null ? '' : santim.toString())}
                                onBlur={field.handleBlur}
                            />
                            <ErrorsOf errors={field.state.meta.errors} touched={field.state.meta.isTouched} />
                        </Field>
                    )}
                </form.AppField>
                <details className="text-sm" data-denominations>
                    <summary className="cursor-pointer">{t('fees.session.count.denominations')}</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                        {session.denominations.map((value) => (
                            <div key={value} className="flex flex-col gap-1">
                                <label htmlFor={`denomination-${value}`} className="text-xs">
                                    {formatMoney(String(value), language)}
                                </label>
                                <input
                                    id={`denomination-${value}`}
                                    inputMode="numeric"
                                    className="border-input h-9 rounded-md border px-2"
                                    value={pieces[value] ?? ''}
                                    onChange={(e) =>
                                        setPieces((p) => ({ ...p, [value]: e.target.value.replace(/\D/g, '') }))
                                    }
                                />
                            </div>
                        ))}
                    </div>
                    <p className="text-muted-foreground mt-2 text-xs">
                        {t('fees.session.count.denominationSum', { sum: formatMoney(sum, language) })}
                    </p>
                </details>
                <form.AppField name="note">
                    {(f) => (
                        <f.TextareaField
                            label={t('fees.session.count.note')}
                            description={t('fees.session.count.noteHint')}
                            maxLength={500}
                        />
                    )}
                </form.AppField>
                {count.error && (
                    <p className="text-destructive text-sm" role="alert">
                        {getApiErrorMessage(count.error)}
                    </p>
                )}
                <div className="flex justify-end">
                    <form.AppForm>
                        <form.SubmitButton data-action="submit-count">
                            {t('fees.session.count.submit')}
                        </form.SubmitButton>
                    </form.AppForm>
                </div>
            </ZodForm>
        </section>
    );
}
