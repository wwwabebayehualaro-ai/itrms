'use client';

/**
 * A receipt (task 0.22b): the office's receipt of a payment, printable from the browser. The official template with its
 * QR verification code comes with task 0.23; until then the screen says so. A reversed receipt is stamped.
 */
import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import {
    Button,
    DescriptionList,
    EmptyState,
    PrintLayout,
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
import { useCan } from '@/lib/auth/authHooks';
import { useAuthStore } from '@/lib/auth/authStore';
import { useIssuedDocuments } from '@/lib/documents';
import { useReceipt } from '@/lib/fees';
import { formatMoment, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { OpenPdfButton } from '../documents/CaseDocuments';
import { ReversalDialog } from './ReversalDialog';

export function ReceiptPage({ id }: { id: string }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const mayRequest = useCan('receipt-reversal:request');
    const activeUnit = useAuthStore((s) => s.workspace?.activeUnit.id);
    const [reversing, setReversing] = useState(false);
    const receipt = useReceipt(id);
    // the document issued for it, once the worker has made its PDF
    const documents = useIssuedDocuments({ subjectId: id }, useCan('issued-document:read'));
    const pdf = documents.data?.items[0];

    if (receipt.isPending) return <Skeleton className="h-64 w-full" />;
    if (receipt.error || !receipt.data)
        return (
            <EmptyState
                variant="error"
                title={t('fees.receipt.notFound')}
                description={getApiErrorMessage(receipt.error)}
            />
        );
    const r = receipt.data;
    return (
        <div className="flex flex-col gap-4" data-screen="receipt" data-receipt={r.id} data-reversed={r.reversed}>
            <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
                <Link
                    href={`/cashier/orders/${r.orderId}`}
                    className="flex w-fit items-center gap-2 text-sm text-primary hover:underline"
                >
                    <ArrowLeft className="size-4" />
                    {t('fees.receipt.backToOrder')}
                </Link>
                <div className="flex gap-2">
                    {r.reversalPending && (
                        <StatusBadge value="waiting" tone="progress" label={t('fees.reversal.waiting')} />
                    )}
                    {mayRequest && !r.reversed && !r.reversalPending && r.unit.id === activeUnit && (
                        <Button variant="outline" data-action="request-reversal" onClick={() => setReversing(true)}>
                            {t('fees.reversal.request')}
                        </Button>
                    )}
                    {pdf?.state === 'rendered' && (
                        <OpenPdfButton document={pdf} label={t('documents.receipt.download')} />
                    )}
                    <Button data-action="print" onClick={() => window.print()}>
                        <Printer />
                        {t('fees.receipt.print')}
                    </Button>
                </div>
            </div>
            <PrintLayout
                className="relative"
                letterhead={<p className="text-lg font-semibold">{text(r.unit.name)}</p>}
                title={t('fees.receipt.title')}
                meta={
                    <>
                        <p data-receipt-number>{t('fees.receipt.number', { number: r.number })}</p>
                        <p>{formatMoment(r.issuedAt, { language, calendar })}</p>
                    </>
                }
                footer={
                    <div className="flex flex-col gap-1">
                        {r.demo && (
                            <p className="font-medium" data-demo>
                                {t('fees.receipt.demo')}
                            </p>
                        )}
                        {pdf?.state === 'rendered' && (
                            <p className="text-muted-foreground" data-qr-on-pdf>
                                {t('fees.receipt.noQrYet')}
                            </p>
                        )}
                    </div>
                }
            >
                {r.reversed && (
                    <p
                        className="absolute top-40 right-16 -rotate-12 rounded border-4 border-destructive px-4 py-1 text-3xl font-bold tracking-wide text-destructive uppercase"
                        data-reversed-stamp
                    >
                        {t('fees.receipt.reversed')}
                    </p>
                )}
                <div className="flex flex-col gap-6">
                    <DescriptionList
                        items={[
                            {
                                term: t('fees.receipt.case'),
                                value: t('workflow.case.number', { number: String(r.caseNumber) })
                            },
                            { term: t('fees.receipt.service'), value: text(r.serviceName) },
                            { term: t('fees.receipt.receivedFrom'), value: r.receivedFrom },
                            { term: t('fees.receipt.method'), value: t(`fees.payment.method.${r.method}`) }
                        ]}
                    />
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('fees.order.col.item')}</TableHead>
                                <TableHead className="text-right">{t('fees.order.col.quantity')}</TableHead>
                                <TableHead className="text-right">{t('fees.order.col.amount')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {r.lines.map((line) => (
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
                                <TableCell className="text-right font-semibold tabular-nums">
                                    {formatMoney(r.amountSantim, language)}
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            </PrintLayout>
            {reversing && (
                <ReversalDialog receiptId={r.id} receiptNumber={r.number} onClose={() => setReversing(false)} />
            )}
        </div>
    );
}
