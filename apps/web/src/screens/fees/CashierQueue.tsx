'use client';

/**
 * The cashier's queue (task 0.22b): the open payment orders of the person's office that are paid at its till, oldest
 * first, found by case number. An order past its due day is marked; one worked out on demo amounts says so.
 */
import Link from 'next/link';
import { useState } from 'react';
import {
    Button,
    EmptyState,
    Input,
    Label,
    PageHeader,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCashierQueue, type PaymentOrderOut } from '@/lib/fees';
import { formatDay, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';

export function CashierQueue() {
    const { t } = useText();
    const [typed, setTyped] = useState('');
    const [number, setNumber] = useState<number | undefined>();
    // the cursors of the pages before this one (a cursor is the last order of the page before)
    const [cursors, setCursors] = useState<string[]>([]);
    const queue = useCashierQueue({ ...(number ? { q: number } : {}), after: cursors[cursors.length - 1] ?? null });
    const items = queue.data?.items ?? [];

    return (
        <div className="flex flex-col gap-6" data-screen="cashier">
            <PageHeader title={t('fees.cashier.title')} description={t('fees.cashier.intro')} />
            <form
                role="search"
                className="flex items-end gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number(typed.trim());
                    setNumber(Number.isInteger(n) && n > 0 ? n : undefined);
                    setCursors([]);
                }}
            >
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cashier-number">{t('fees.cashier.number')}</Label>
                    <Input
                        id="cashier-number"
                        inputMode="numeric"
                        className="w-40"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                    />
                </div>
                <Button type="submit" variant="outline">
                    {t('fees.cashier.find')}
                </Button>
            </form>

            {queue.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : queue.error ? (
                <EmptyState
                    variant="error"
                    title={t('fees.cashier.error')}
                    description={getApiErrorMessage(queue.error)}
                />
            ) : items.length === 0 ? (
                <EmptyState title={t('fees.cashier.empty')} description={t('fees.cashier.emptyHint')} />
            ) : (
                <>
                    <Table data-queue>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('fees.cashier.col.case')}</TableHead>
                                <TableHead>{t('fees.cashier.col.service')}</TableHead>
                                <TableHead className="text-right">{t('fees.cashier.col.total')}</TableHead>
                                <TableHead>{t('fees.cashier.col.due')}</TableHead>
                                <TableHead className="text-right">{t('fees.cashier.col.actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((order) => (
                                <QueueRow key={order.id} order={order} />
                            ))}
                        </TableBody>
                    </Table>
                    <div className="flex items-center justify-end gap-2">
                        <Button
                            variant="outline"
                            disabled={cursors.length === 0}
                            onClick={() => setCursors((c) => c.slice(0, -1))}
                        >
                            {t('fees.cashier.previous')}
                        </Button>
                        <Button
                            variant="outline"
                            // a full page may have a next one
                            disabled={items.length < 50}
                            onClick={() => {
                                const last = items[items.length - 1];
                                if (last) setCursors((c) => [...c, last.id]);
                            }}
                        >
                            {t('fees.cashier.next')}
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}

function QueueRow({ order }: { order: PaymentOrderOut }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    return (
        <TableRow data-order={order.id} data-case-number={order.caseNumber}>
            <TableCell className="font-medium">
                {t('workflow.case.number', { number: String(order.caseNumber) })}
            </TableCell>
            <TableCell>{text(order.serviceName)}</TableCell>
            <TableCell className="text-right tabular-nums">
                <div className="flex flex-col items-end gap-1">
                    {formatMoney(order.totalSantim, language)}
                    {order.demo && <StatusBadge value="demo" tone="info" label={t('fees.order.demo')} />}
                </div>
            </TableCell>
            <TableCell>
                <div className="flex flex-col items-start gap-1">
                    {formatDay(order.dueOn, { language, calendar })}
                    {order.overdue && <StatusBadge value="overdue" tone="danger" label={t('fees.order.overdue')} />}
                </div>
            </TableCell>
            <TableCell className="text-right">
                <Button asChild size="sm">
                    <Link href={`/cashier/orders/${order.id}`}>{t('fees.cashier.open')}</Link>
                </Button>
            </TableCell>
        </TableRow>
    );
}
