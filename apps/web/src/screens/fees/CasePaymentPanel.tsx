'use client';

/**
 * A case's payment (task 0.22b) on its page: the state of its newest payment order, the total, the receipts issued and a
 * link to the order for the cashier. A case with no order shows nothing.
 */
import Link from 'next/link';
import { StatusBadge, type Tone } from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useCasePayment, type PaymentOrderOut } from '@/lib/fees';
import { formatMoney } from '@/lib/format';
import { useText } from '@/lib/preferences';

const ORDER_TONE: Record<PaymentOrderOut['state'], Tone> = { open: 'progress', settled: 'success', cancelled: 'muted' };

export function CasePaymentPanel({ caseId }: { caseId: string }) {
    const { t, language } = useText();
    const mayRecord = useCan('payment:record');
    const payment = useCasePayment(caseId);
    const order = payment.data;
    if (!order) return null;
    const receipts = order.payments.filter((p) => p.receiptId && p.receiptNumber);
    return (
        <section
            className="flex flex-col gap-2 rounded-md border p-4"
            data-case-payment={order.id}
            data-state={order.state}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">{t('fees.case.title')}</h2>
                <div className="flex items-center gap-2">
                    {order.demo && <StatusBadge value="demo" tone="info" label={t('fees.order.demo')} />}
                    <StatusBadge
                        value={order.state}
                        tone={ORDER_TONE[order.state]}
                        label={t(`fees.order.state.${order.state}`)}
                    />
                </div>
            </div>
            <p className="text-sm">
                {t('fees.case.total', { total: formatMoney(order.totalSantim, language) })}
                {order.collection === 'elsewhere' && ` · ${t('fees.order.collectedElsewhere')}`}
            </p>
            {receipts.length > 0 && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-case-receipts>
                    {receipts.map((p) => (
                        <li key={p.id} data-voided={p.voided}>
                            <Link href={`/receipts/${p.receiptId}`} className="text-primary hover:underline">
                                {t('fees.case.receipt', { number: p.receiptNumber ?? '' })}
                            </Link>
                            {p.voided && ` (${t('fees.receipt.reversed')})`}
                        </li>
                    ))}
                </ul>
            )}
            {mayRecord && (
                <Link href={`/cashier/orders/${order.id}`} className="w-fit text-sm text-primary hover:underline">
                    {t('fees.case.openOrder')}
                </Link>
            )}
        </section>
    );
}
