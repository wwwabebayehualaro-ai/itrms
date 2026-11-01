'use client';

/**
 * The receipt reversals waiting for a decision (task 0.22b): the person who decides (the region's setting names the
 * roles) approves or rejects with an optional note. Never the person who asked for it, nor the cashier who took the
 * money: the server refuses them and says so.
 */
import Link from 'next/link';
import { useState } from 'react';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    EmptyState,
    Label,
    PageHeader,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Textarea,
    useNotify
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useDecideReversal, useReversalInbox, type ReversalOut } from '@/lib/fees';
import { formatMoment, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';

type Decision = 'approved' | 'rejected';

export function ReversalInbox() {
    const { t } = useText();
    const inbox = useReversalInbox();
    const [deciding, setDeciding] = useState<{ reversal: ReversalOut; decision: Decision } | null>(null);

    return (
        <div className="flex flex-col gap-6" data-screen="reversals">
            <PageHeader title={t('fees.reversal.title')} description={t('fees.reversal.intro')} />
            {inbox.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : inbox.error ? (
                <EmptyState
                    variant="error"
                    title={t('fees.reversal.error')}
                    description={getApiErrorMessage(inbox.error)}
                />
            ) : inbox.data.items.length === 0 ? (
                <EmptyState title={t('fees.reversal.empty')} description={t('fees.reversal.emptyHint')} />
            ) : (
                <Table data-reversals>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('fees.reversal.col.receipt')}</TableHead>
                            <TableHead>{t('fees.reversal.col.case')}</TableHead>
                            <TableHead className="text-right">{t('fees.reversal.col.amount')}</TableHead>
                            <TableHead>{t('fees.reversal.col.reason')}</TableHead>
                            <TableHead>{t('fees.reversal.col.office')}</TableHead>
                            <TableHead>{t('fees.reversal.col.requestedAt')}</TableHead>
                            <TableHead className="text-right">{t('fees.reversal.col.actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {inbox.data.items.map((r) => (
                            <ReversalRow
                                key={r.id}
                                reversal={r}
                                onDecide={(decision) => setDeciding({ reversal: r, decision })}
                            />
                        ))}
                    </TableBody>
                </Table>
            )}
            {deciding && <DecisionDialog {...deciding} onClose={() => setDeciding(null)} />}
        </div>
    );
}

function ReversalRow({ reversal: r, onDecide }: { reversal: ReversalOut; onDecide: (decision: Decision) => void }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    return (
        <TableRow data-reversal={r.id} data-receipt-number={r.receiptNumber}>
            <TableCell>
                <Link href={`/receipts/${r.receiptId}`} className="text-primary hover:underline">
                    {r.receiptNumber}
                </Link>
            </TableCell>
            <TableCell>
                <Link href={`/cases/${r.caseId}`} className="text-primary hover:underline">
                    {t('workflow.case.number', { number: String(r.caseNumber) })}
                </Link>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(r.amountSantim, language)}</TableCell>
            <TableCell className="max-w-xs whitespace-pre-wrap">{r.reason}</TableCell>
            <TableCell>{text(r.unit.name)}</TableCell>
            <TableCell>{formatMoment(r.requestedAt, { language, calendar })}</TableCell>
            <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                    <Button size="sm" data-action="approve" onClick={() => onDecide('approved')}>
                        {t('fees.reversal.approve')}
                    </Button>
                    <Button size="sm" variant="outline" data-action="reject" onClick={() => onDecide('rejected')}>
                        {t('fees.reversal.reject')}
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}

function DecisionDialog({
    reversal,
    decision,
    onClose
}: {
    reversal: ReversalOut;
    decision: Decision;
    onClose: () => void;
}) {
    const { t } = useText();
    const notify = useNotify();
    const decide = useDecideReversal();
    const [note, setNote] = useState('');
    const name = decision === 'approved' ? t('fees.reversal.approve') : t('fees.reversal.reject');
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-decision-dialog={decision}>
                <DialogHeader>
                    <DialogTitle>{name}</DialogTitle>
                    <DialogDescription>
                        {t('fees.reversal.decideIntro', { number: reversal.receiptNumber })}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reversal-note">{t('fees.reversal.note')}</Label>
                    <Textarea
                        id="reversal-note"
                        value={note}
                        maxLength={500}
                        onChange={(e) => setNote(e.target.value)}
                    />
                </div>
                {decide.error && (
                    <p className="text-destructive text-sm" role="alert">
                        {getApiErrorMessage(decide.error)}
                    </p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('fees.reversal.cancel')}
                    </Button>
                    <Button
                        disabled={decide.isPending}
                        onClick={() =>
                            decide.mutate(
                                { id: reversal.id, decision, ...(note.trim() ? { note: note.trim() } : {}) },
                                {
                                    onSuccess: () => {
                                        notify.success(t(`fees.reversal.decided.${decision}`));
                                        onClose();
                                    }
                                }
                            )
                        }
                    >
                        {name}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
