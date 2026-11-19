'use client';

/**
 * The counts with a difference waiting for a decision (task 1.12, ADR-0063): the person who decides (the region's
 * `fees.sessions.approverRoles` names the roles) approves or rejects, a rejection with a note. Never the cashier who
 * counted: the server refuses and says so.
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
import { useClosingInbox, useDecideCount, type CashierSessionOut } from '@/lib/fees';
import { formatDay, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';

type Decision = 'approve' | 'reject';

export function ClosingInbox() {
    const { t } = useText();
    const inbox = useClosingInbox();
    const [deciding, setDeciding] = useState<{ session: CashierSessionOut; decision: Decision } | null>(null);

    return (
        <div className="flex flex-col gap-6" data-screen="closings">
            <PageHeader title={t('fees.closing.title')} description={t('fees.closing.intro')} />
            {inbox.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : inbox.error ? (
                <EmptyState
                    variant="error"
                    title={t('fees.closing.error')}
                    description={getApiErrorMessage(inbox.error)}
                />
            ) : inbox.data.items.length === 0 ? (
                <EmptyState title={t('fees.closing.empty')} description={t('fees.closing.emptyHint')} />
            ) : (
                <Table data-closings>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('fees.closing.col.day')}</TableHead>
                            <TableHead>{t('fees.closing.col.office')}</TableHead>
                            <TableHead className="text-right">{t('fees.closing.col.expected')}</TableHead>
                            <TableHead className="text-right">{t('fees.closing.col.counted')}</TableHead>
                            <TableHead className="text-right">{t('fees.closing.col.difference')}</TableHead>
                            <TableHead>{t('fees.closing.col.note')}</TableHead>
                            <TableHead className="text-right">{t('fees.closing.col.actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {inbox.data.items.map((s) => (
                            <ClosingRow
                                key={s.id}
                                session={s}
                                onDecide={(decision) => setDeciding({ session: s, decision })}
                            />
                        ))}
                    </TableBody>
                </Table>
            )}
            {deciding && <DecisionDialog {...deciding} onClose={() => setDeciding(null)} />}
        </div>
    );
}

const pendingOf = (s: CashierSessionOut) => s.counts.find((c) => c.state === 'pending');

function ClosingRow({ session: s, onDecide }: { session: CashierSessionOut; onDecide: (d: Decision) => void }) {
    const { t, language } = useText();
    const calendar = usePreferences((p) => p.calendar);
    const count = pendingOf(s);
    return (
        <TableRow data-closing={s.id} data-count={count?.id}>
            <TableCell>
                <Link href={`/cashier/sessions/${s.id}`} className="text-primary hover:underline">
                    {formatDay(s.businessDay, { language, calendar })}
                </Link>
            </TableCell>
            <TableCell>{s.unit.code}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(s.expectedCashSantim, language)}</TableCell>
            <TableCell className="text-right tabular-nums">
                {count ? formatMoney(count.countedSantim, language) : '—'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
                {count ? formatMoney(count.differenceSantim, language) : '—'}
            </TableCell>
            <TableCell className="max-w-xs whitespace-pre-wrap">{count?.note ?? ''}</TableCell>
            <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                    <Button size="sm" data-action="approve" onClick={() => onDecide('approve')}>
                        {t('fees.closing.approve')}
                    </Button>
                    <Button size="sm" variant="outline" data-action="reject" onClick={() => onDecide('reject')}>
                        {t('fees.closing.reject')}
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}

function DecisionDialog({
    session,
    decision,
    onClose
}: {
    session: CashierSessionOut;
    decision: Decision;
    onClose: () => void;
}) {
    const { t, language } = useText();
    const calendar = usePreferences((p) => p.calendar);
    const notify = useNotify();
    const decide = useDecideCount();
    const [note, setNote] = useState('');
    const count = pendingOf(session);
    const name = t(decision === 'approve' ? 'fees.closing.approve' : 'fees.closing.reject');
    const needsNote = decision === 'reject' && note.trim().length < 3;
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-decision-dialog={decision}>
                <DialogHeader>
                    <DialogTitle>{name}</DialogTitle>
                    <DialogDescription>
                        {t('fees.closing.decideIntro', { day: formatDay(session.businessDay, { language, calendar }) })}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="closing-note">{t('fees.closing.note')}</Label>
                    <Textarea
                        id="closing-note"
                        value={note}
                        maxLength={500}
                        onChange={(e) => setNote(e.target.value)}
                    />
                    {decision === 'reject' && (
                        <p className="text-muted-foreground text-xs">{t('fees.closing.noteHint')}</p>
                    )}
                </div>
                {decide.error && (
                    <p className="text-destructive text-sm" role="alert">
                        {getApiErrorMessage(decide.error)}
                    </p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('fees.closing.cancel')}
                    </Button>
                    <Button
                        disabled={decide.isPending || !count || needsNote}
                        data-action="confirm-decision"
                        onClick={() =>
                            count &&
                            decide.mutate(
                                { id: count.id, decision, ...(note.trim() ? { note: note.trim() } : {}) },
                                {
                                    onSuccess: () => {
                                        notify.success(t(`fees.closing.decided.${decision}`));
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
