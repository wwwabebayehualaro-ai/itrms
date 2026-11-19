'use client';

/**
 * The office's remittances (task 1.12d, ADR-0063 §5): prepare one for the closed cashier days up to a day, looking at what it
 * would carry first (nothing is stored by the look), and the remittances so far. Sessions not yet counted are listed as left out.
 */
import Link from 'next/link';
import { useState } from 'react';
import {
    Button,
    EmptyState,
    EthiopianDatePicker,
    Field,
    FieldLabel,
    PageHeader,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useNotify
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { usePrepareRemittance, useRemittancePreview, useRemittances, type RemittanceOut } from '@/lib/fees';
import { formatDay, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { todayInAddis } from './form-bits';

export function RemittanceList() {
    const { t } = useText();
    const list = useRemittances();
    return (
        <div className="flex flex-col gap-6" data-screen="remittances">
            <PageHeader title={t('fees.remittance.title')} description={t('fees.remittance.intro')} />
            {useCan('remittance:prepare') && <PrepareRemittance />}
            {list.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : list.error ? (
                <EmptyState
                    variant="error"
                    title={t('fees.remittance.error')}
                    description={getApiErrorMessage(list.error)}
                />
            ) : list.data.items.length === 0 ? (
                <EmptyState title={t('fees.remittance.empty')} description={t('fees.remittance.emptyHint')} />
            ) : (
                <RemittanceTable items={list.data.items} />
            )}
        </div>
    );
}

function PrepareRemittance() {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const notify = useNotify();
    const [through, setThrough] = useState<string | null>(null);
    const preview = useRemittancePreview(through);
    const prepare = usePrepareRemittance();
    const p = preview.data;
    return (
        <section className="flex flex-col gap-3 rounded-md border p-4" data-remittance-prepare>
            <h2 className="font-medium">{t('fees.remittance.prepare.title')}</h2>
            <p className="text-muted-foreground text-sm">{t('fees.remittance.prepare.intro')}</p>
            <Field>
                <FieldLabel htmlFor="remittance-through">{t('fees.remittance.prepare.through')}</FieldLabel>
                <EthiopianDatePicker
                    id="remittance-through"
                    value={through}
                    onChange={setThrough}
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
            </Field>
            {through && preview.isPending && <Skeleton className="h-24 w-full" />}
            {preview.error && (
                <p className="text-destructive text-sm" role="alert">
                    {getApiErrorMessage(preview.error)}
                </p>
            )}
            {p && (
                <div className="flex flex-col gap-3" data-remittance-preview>
                    {p.demo && (
                        <p className="font-medium" data-demo>
                            {t('fees.remittance.demo')}
                        </p>
                    )}
                    {p.sessions.length === 0 ? (
                        <p className="text-muted-foreground text-sm" data-nothing-to-remit>
                            {t('fees.remittance.prepare.nothing')}
                        </p>
                    ) : (
                        <>
                            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                                <Figure label={t('fees.remittance.total')} value={p.revenueTotalSantim} />
                                <Figure label={t('fees.remittance.cash')} value={p.cashSantim} />
                                <Figure label={t('fees.remittance.bankSlip')} value={p.bankSlipSantim} />
                                <Figure label={t('fees.remittance.reversals')} value={p.reversalSantim} />
                                <Figure label={t('fees.remittance.difference')} value={p.differenceSantim} />
                                <Figure label={t('fees.remittance.depositDue')} value={p.depositDueSantim} strong />
                            </dl>
                            <p className="text-sm">
                                {t('fees.remittance.prepare.sessions', { count: String(p.sessions.length) })}
                            </p>
                            <ul className="text-sm">
                                {p.groups
                                    .filter((g) => g.mappedByDefault)
                                    .map((g) => (
                                        <li key={`${g.accountCode}/${g.budgetCategory}`} data-by-default>
                                            {t('fees.remittance.byDefault', {
                                                account: `${g.accountCode} ${text(g.accountName)}`
                                            })}
                                        </li>
                                    ))}
                            </ul>
                        </>
                    )}
                    {p.notYetClosed.length > 0 && (
                        <div data-not-yet-closed>
                            <p className="text-sm font-medium">{t('fees.remittance.notYetClosed')}</p>
                            <ul className="text-muted-foreground text-sm">
                                {p.notYetClosed.map((s) => (
                                    <li key={s.id}>
                                        {formatDay(s.businessDay, { language, calendar })}:{' '}
                                        {t(`fees.session.state.${s.state}`)}
                                        {s.overdue ? ` (${t('fees.remittance.overdue')})` : ''}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {p.blocked && (
                        <p className="text-destructive text-sm" role="alert" data-blocked={p.blocked}>
                            {t(`fees.remittance.blocked.${p.blocked}`)}
                        </p>
                    )}
                    {p.sessions.length > 0 && (
                        <div className="flex justify-end">
                            <Button
                                disabled={prepare.isPending || p.blocked !== null}
                                data-action="prepare-remittance"
                                onClick={() =>
                                    through &&
                                    prepare.mutate(
                                        { through },
                                        { onSuccess: () => notify.success(t('fees.remittance.prepared')) }
                                    )
                                }
                            >
                                {t('fees.remittance.prepare.submit')}
                            </Button>
                        </div>
                    )}
                    {prepare.error && (
                        <p className="text-destructive text-sm" role="alert">
                            {getApiErrorMessage(prepare.error)}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}

export function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    const { language } = useText();
    return (
        <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{formatMoney(value, language)}</dd>
        </div>
    );
}

function RemittanceTable({ items }: { items: RemittanceOut[] }) {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    return (
        <Table data-remittances>
            <TableHeader>
                <TableRow>
                    <TableHead>{t('fees.remittance.col.number')}</TableHead>
                    <TableHead>{t('fees.remittance.col.period')}</TableHead>
                    <TableHead className="text-right">{t('fees.remittance.col.total')}</TableHead>
                    <TableHead className="text-right">{t('fees.remittance.col.depositDue')}</TableHead>
                    <TableHead>{t('fees.remittance.col.state')}</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {items.map((r) => (
                    <TableRow key={r.id} data-remittance={r.id}>
                        <TableCell>
                            <Link href={`/finance/remittances/${r.id}`} className="text-primary hover:underline">
                                {r.number}
                            </Link>
                        </TableCell>
                        <TableCell>
                            {formatDay(r.periodFrom, { language, calendar })} –{' '}
                            {formatDay(r.periodTo, { language, calendar })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                            {formatMoney(r.revenueTotalSantim, language)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                            {formatMoney(r.depositDueSantim, language)}
                        </TableCell>
                        <TableCell>
                            <StatusBadge
                                value={r.state}
                                tone={r.state === 'prepared' ? 'progress' : 'success'}
                                label={t(`fees.remittance.state.${r.state}`)}
                            />
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
