'use client';

/**
 * The task inbox (task 0.20b): the open steps of the active office for the roles the person holds there, by due time
 * (overdue first). A step is taken on ("claimed") by one of the role's holders; the others see whose it is. A step the
 * person may not take (they acted on an earlier one: separation of duties) is listed, marked, without the claim.
 */
import Link from 'next/link';
import { useState } from 'react';
import {
    Button,
    EmptyState,
    Input,
    Label,
    PageHeader,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    ToggleGroup,
    ToggleGroupItem,
    type Tone
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { formatMoment } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { useClaim, useInbox, type InboxFilters, type InboxItem, type SlaState } from '@/lib/workflow';

const SLA_TONE: Record<SlaState, Tone> = {
    none: 'muted',
    'on-time': 'success',
    'due-soon': 'warning',
    overdue: 'danger'
};

type Claim = NonNullable<InboxFilters['claim']>;
type Sla = 'any' | NonNullable<InboxFilters['sla']>;

export function Inbox() {
    const { t } = useText();
    const [claim, setClaim] = useState<Claim>('all');
    const [sla, setSla] = useState<Sla>('any');
    const [typed, setTyped] = useState('');
    const [number, setNumber] = useState<number | undefined>();
    // the cursors of the pages before this one (a cursor is the last task of the page before)
    const [cursors, setCursors] = useState<string[]>([]);
    const after = cursors[cursors.length - 1] ?? null;
    const filters: InboxFilters = { claim, ...(sla === 'any' ? {} : { sla }), ...(number ? { number } : {}) };
    const inbox = useInbox(filters, after);
    const refilter = (change: () => void) => {
        change();
        setCursors([]);
    };

    return (
        <div className="flex flex-col gap-6" data-screen="inbox">
            <PageHeader title={t('workflow.inbox.title')} description={t('workflow.inbox.intro')} />
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <ToggleGroup
                    type="single"
                    variant="outline"
                    value={claim}
                    onValueChange={(v) => v && refilter(() => setClaim(v as Claim))}
                    aria-label={t('workflow.inbox.claimFilter')}
                >
                    {(['all', 'mine', 'unclaimed'] as const).map((c) => (
                        <ToggleGroupItem key={c} value={c} data-claim={c}>
                            {t(`workflow.inbox.claim.${c}`)}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
                <div className="flex flex-col gap-1.5">
                    <Label id="inbox-sla-label">{t('workflow.inbox.slaFilter')}</Label>
                    <Select value={sla} onValueChange={(v) => refilter(() => setSla(v as Sla))}>
                        <SelectTrigger className="w-48" aria-labelledby="inbox-sla-label" data-filter="sla">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent aria-labelledby="inbox-sla-label">
                            {(['any', 'overdue', 'due-soon'] as const).map((s) => (
                                <SelectItem key={s} value={s}>
                                    {t(`workflow.inbox.sla.${s}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <form
                    role="search"
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        const n = Number(typed.trim());
                        refilter(() => setNumber(Number.isInteger(n) && n > 0 ? n : undefined));
                    }}
                >
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="inbox-number">{t('workflow.inbox.number')}</Label>
                        <Input
                            id="inbox-number"
                            inputMode="numeric"
                            className="w-36"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                        />
                    </div>
                    <Button type="submit" variant="outline">
                        {t('workflow.inbox.find')}
                    </Button>
                </form>
            </div>

            {inbox.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : inbox.error ? (
                <EmptyState
                    variant="error"
                    title={t('workflow.inbox.error')}
                    description={getApiErrorMessage(inbox.error)}
                />
            ) : inbox.data.items.length === 0 ? (
                <EmptyState title={t('workflow.inbox.empty')} description={t('workflow.inbox.emptyHint')} />
            ) : (
                <>
                    <Table data-inbox>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('workflow.inbox.col.case')}</TableHead>
                                <TableHead>{t('workflow.inbox.col.step')}</TableHead>
                                <TableHead>{t('workflow.inbox.col.due')}</TableHead>
                                <TableHead>{t('workflow.inbox.col.claimedBy')}</TableHead>
                                <TableHead className="text-right">{t('workflow.inbox.col.actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {inbox.data.items.map((item) => (
                                <InboxRow key={item.taskId} item={item} />
                            ))}
                        </TableBody>
                    </Table>
                    <div className="flex items-center justify-end gap-2">
                        <Button
                            variant="outline"
                            disabled={cursors.length === 0}
                            onClick={() => setCursors((c) => c.slice(0, -1))}
                        >
                            {t('workflow.inbox.previous')}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={!inbox.data.nextCursor}
                            onClick={() => {
                                const next = inbox.data.nextCursor;
                                if (next) setCursors((c) => [...c, next]);
                            }}
                        >
                            {t('workflow.inbox.next')}
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}

function InboxRow({ item }: { item: InboxItem }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const me = useAuthStore((s) => s.user?.id);
    const claim = useClaim(item.caseId);
    const mine = item.claimedBy?.id === me;
    return (
        <TableRow data-task={item.taskId} data-case-number={item.caseNumber}>
            <TableCell>
                <Link href={`/cases/${item.caseId}`} className="font-medium text-primary hover:underline">
                    {t('workflow.case.number', { number: String(item.caseNumber) })}
                </Link>
                <div className="text-muted-foreground text-xs">{text(item.workflow.name)}</div>
            </TableCell>
            <TableCell>
                {item.stateLabel ? text(item.stateLabel) : item.state}
                {item.routedFrom && (
                    <div className="text-muted-foreground text-xs">
                        {t('workflow.case.routedFrom', { unit: text(item.routedFrom.name) })}
                    </div>
                )}
            </TableCell>
            <TableCell>
                <div className="flex flex-col items-start gap-1">
                    <StatusBadge value={item.sla} tone={SLA_TONE[item.sla]} label={t(`workflow.sla.${item.sla}`)} />
                    {item.dueAt && (
                        <span className="text-muted-foreground text-xs">
                            {formatMoment(item.dueAt, { language, calendar })}
                        </span>
                    )}
                </div>
            </TableCell>
            <TableCell data-claimed-by={item.claimedBy?.id ?? ''}>
                {item.claimedBy ? (mine ? t('workflow.inbox.you') : item.claimedBy.name) : '—'}
                {!item.mayAct && <div className="text-muted-foreground text-xs">{t('workflow.inbox.notYours')}</div>}
            </TableCell>
            <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                    {!item.claimedBy && item.mayAct && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={claim.isPending}
                            onClick={() => claim.mutate({ taskId: item.taskId })}
                        >
                            {t('workflow.action.claim')}
                        </Button>
                    )}
                    {mine && (
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={claim.isPending}
                            onClick={() => claim.mutate({ taskId: item.taskId, release: true })}
                        >
                            {t('workflow.action.release')}
                        </Button>
                    )}
                    <Button asChild size="sm">
                        <Link href={`/cases/${item.caseId}`}>{t('workflow.action.open')}</Link>
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}
