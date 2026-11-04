'use client';

/**
 * The references paid elsewhere waiting for a decision (task 0.22c): the person checks each against the issuer's receipt or
 * records, with what ITRMS knows beside it (the same reference rejected before, what a statement says). A rejection says
 * why. Who entered a reference never decides it: the server refuses them and says so.
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
import { useDecideExternalRef, useExternalIssuers, useExternalRefInbox, type ExternalRefOut } from '@/lib/fees';
import { formatDay, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';

type Decision = 'verified' | 'rejected';

export function ExternalRefInbox() {
    const { t } = useText();
    const inbox = useExternalRefInbox();
    const [deciding, setDeciding] = useState<{ reference: ExternalRefOut; decision: Decision } | null>(null);

    return (
        <div className="flex flex-col gap-6" data-screen="external-refs">
            <PageHeader title={t('fees.external.title')} description={t('fees.external.intro')} />
            {inbox.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : inbox.error ? (
                <EmptyState
                    variant="error"
                    title={t('fees.external.error')}
                    description={getApiErrorMessage(inbox.error)}
                />
            ) : inbox.data.items.length === 0 ? (
                <EmptyState title={t('fees.external.empty')} description={t('fees.external.emptyHint')} />
            ) : (
                <Table data-external-inbox>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('fees.external.col.case')}</TableHead>
                            <TableHead>{t('fees.external.col.issuer')}</TableHead>
                            <TableHead>{t('fees.external.col.reference')}</TableHead>
                            <TableHead>{t('fees.external.col.paidOn')}</TableHead>
                            <TableHead className="text-right">{t('fees.external.col.amount')}</TableHead>
                            <TableHead>{t('fees.external.col.office')}</TableHead>
                            <TableHead>{t('fees.external.col.check')}</TableHead>
                            <TableHead className="text-right">{t('fees.external.col.actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {inbox.data.items.map((r) => (
                            <RefRow
                                key={r.id}
                                reference={r}
                                onDecide={(decision) => setDeciding({ reference: r, decision })}
                            />
                        ))}
                    </TableBody>
                </Table>
            )}
            {deciding && <DecisionDialog {...deciding} onClose={() => setDeciding(null)} />}
        </div>
    );
}

/** What the person should look at: never a verdict, only what ITRMS knows. */
function Flags({ reference: r }: { reference: ExternalRefOut }) {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const flags: string[] = [];
    if (r.rejectedBefore > 0) flags.push(t('fees.external.flag.rejectedBefore', { count: String(r.rejectedBefore) }));
    if (r.paidBeforeOrder) flags.push(t('fees.external.flag.paidBeforeOrder'));
    if (!r.statement) flags.push(t('fees.external.flag.statementNone'));
    else {
        if (r.statement.amountSantim !== null && r.statement.amountSantim !== r.amountSantim)
            flags.push(
                t('fees.external.flag.statementAmount', { amount: formatMoney(r.statement.amountSantim, language) })
            );
        if (r.statement.paidOn !== null && r.statement.paidOn !== r.paidOn)
            flags.push(
                t('fees.external.flag.statementDate', { date: formatDay(r.statement.paidOn, { language, calendar }) })
            );
        if (r.statement.amountSantim === r.amountSantim && r.statement.paidOn === r.paidOn)
            flags.push(t('fees.external.flag.statementFound'));
    }
    return (
        <ul className="flex flex-col gap-0.5 text-xs" data-flags>
            {flags.map((flag) => (
                <li key={flag}>{flag}</li>
            ))}
        </ul>
    );
}

function RefRow({ reference: r, onDecide }: { reference: ExternalRefOut; onDecide: (decision: Decision) => void }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const issuers = useExternalIssuers();
    const issuer = issuers.data?.items.find((i) => i.code === r.issuer);
    return (
        <TableRow data-external-ref={r.id} data-reference={r.reference}>
            <TableCell>
                <Link href={`/cases/${r.caseId}`} className="text-primary hover:underline">
                    {t('workflow.case.number', { number: String(r.caseNumber) })}
                </Link>
            </TableCell>
            <TableCell>{issuer ? text(issuer.name) : r.issuer}</TableCell>
            <TableCell>{r.reference}</TableCell>
            <TableCell>{formatDay(r.paidOn, { language, calendar })}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(r.amountSantim, language)}</TableCell>
            <TableCell>{text(r.unit.name)}</TableCell>
            <TableCell>
                <Flags reference={r} />
            </TableCell>
            <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                    <Button size="sm" data-action="verify" onClick={() => onDecide('verified')}>
                        {t('fees.external.verify')}
                    </Button>
                    <Button size="sm" variant="outline" data-action="reject" onClick={() => onDecide('rejected')}>
                        {t('fees.external.reject')}
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}

function DecisionDialog({
    reference,
    decision,
    onClose
}: {
    reference: ExternalRefOut;
    decision: Decision;
    onClose: () => void;
}) {
    const { t } = useText();
    const notify = useNotify();
    const decide = useDecideExternalRef();
    const [note, setNote] = useState('');
    const name = decision === 'verified' ? t('fees.external.verify') : t('fees.external.reject');
    const usable = decision === 'verified' || note.trim().length > 0;
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-decision-dialog={decision}>
                <DialogHeader>
                    <DialogTitle>{name}</DialogTitle>
                    <DialogDescription>
                        {reference.issuer}/{reference.reference}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="external-note">
                        {decision === 'rejected' ? t('fees.external.rejectReason') : t('fees.reversal.note')}
                    </Label>
                    <Textarea
                        id="external-note"
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
                        disabled={!usable || decide.isPending}
                        onClick={() =>
                            decide.mutate(
                                { id: reference.id, decision, ...(note.trim() ? { note: note.trim() } : {}) },
                                {
                                    onSuccess: () => {
                                        notify.success(t(`fees.external.decided.${decision}`));
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
