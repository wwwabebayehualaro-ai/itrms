'use client';

/**
 * The requests of the office and those below it, across services (task 0.21e): those waiting (open, the longest waiting
 * first), where each stands and who has it now, or the recent ones (the last changed first). A request is opened on its
 * case page, where it is acted on (and changed, where its workflow allows).
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
    Switch,
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
import { useCaseList, type CaseListFilters, type CaseListItem, type SlaState } from '@/lib/workflow';

const SLA_TONE: Record<SlaState, Tone> = {
    none: 'muted',
    'on-time': 'success',
    'due-soon': 'warning',
    overdue: 'danger'
};

type List = NonNullable<CaseListFilters['list']>;

export function Requests() {
    const { t } = useText();
    const [list, setList] = useState<List>('waiting');
    const [mine, setMine] = useState(false);
    const [typed, setTyped] = useState('');
    const [number, setNumber] = useState<number | undefined>();
    // the cursors of the pages before this one (a cursor is the last case of the page before)
    const [cursors, setCursors] = useState<string[]>([]);
    const after = cursors[cursors.length - 1] ?? null;
    const filters: CaseListFilters = { list, ...(mine ? { mine } : {}), ...(number ? { number } : {}) };
    const requests = useCaseList(filters, after);
    const refilter = (change: () => void) => {
        change();
        setCursors([]);
    };

    return (
        <div className="flex flex-col gap-6" data-screen="requests">
            <PageHeader title={t('workflow.requests.title')} description={t('workflow.requests.intro')} />
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <ToggleGroup
                    type="single"
                    variant="outline"
                    value={list}
                    onValueChange={(v) => v && refilter(() => setList(v as List))}
                    aria-label={t('workflow.requests.listFilter')}
                >
                    {(['waiting', 'recent'] as const).map((l) => (
                        <ToggleGroupItem key={l} value={l} data-list={l}>
                            {t(`workflow.requests.list.${l}`)}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
                <div className="flex items-center gap-2 pb-2">
                    <Switch
                        id="requests-mine"
                        checked={mine}
                        onCheckedChange={(v) => refilter(() => setMine(v))}
                        data-filter="mine"
                    />
                    <Label htmlFor="requests-mine">{t('workflow.requests.mine')}</Label>
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
                        <Label htmlFor="requests-number">{t('workflow.inbox.number')}</Label>
                        <Input
                            id="requests-number"
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

            {requests.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : requests.error ? (
                <EmptyState
                    variant="error"
                    title={t('workflow.requests.error')}
                    description={getApiErrorMessage(requests.error)}
                />
            ) : requests.data.items.length === 0 ? (
                <EmptyState
                    title={t(`workflow.requests.empty.${list}`)}
                    description={t('workflow.requests.emptyHint')}
                />
            ) : (
                <>
                    <Table data-requests={list}>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('workflow.inbox.col.case')}</TableHead>
                                <TableHead>{t('workflow.requests.col.state')}</TableHead>
                                <TableHead>{t('workflow.requests.col.with')}</TableHead>
                                <TableHead>{t('workflow.requests.col.started')}</TableHead>
                                <TableHead className="text-right">{t('workflow.inbox.col.actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {requests.data.items.map((item) => (
                                <RequestRow key={item.id} item={item} />
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
                            disabled={!requests.data.nextCursor}
                            onClick={() => {
                                const next = requests.data.nextCursor;
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

function RequestRow({ item }: { item: CaseListItem }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const roleLabels = useAuthStore((s) => s.workspace?.roleLabels);
    const roleName = (role: string) => (roleLabels?.[role] ? text(roleLabels[role]) : role);
    const step = item.openStep;
    return (
        <TableRow data-case={item.id} data-case-number={item.number} data-state={item.state}>
            <TableCell>
                <Link href={`/cases/${item.id}`} className="font-medium text-primary hover:underline">
                    {t('workflow.case.number', { number: String(item.number) })}
                </Link>
                <div className="text-muted-foreground text-xs">
                    {item.service ? text(item.service.name) || item.service.code : text(item.workflow.name)}
                </div>
            </TableCell>
            <TableCell>
                <StatusBadge
                    value={item.closed ? 'closed' : item.state}
                    tone={item.closed ? 'success' : 'progress'}
                    label={item.stateLabel ? text(item.stateLabel) : item.state}
                />
                <div className="text-muted-foreground text-xs">
                    {formatMoment(item.closedAt ?? item.updatedAt, { language, calendar })}
                </div>
            </TableCell>
            <TableCell>
                {step ? (
                    <div className="flex flex-col items-start gap-1">
                        <span className="text-sm">
                            {t('workflow.case.assigned', { role: roleName(step.role), unit: text(step.unit.name) })}
                        </span>
                        <StatusBadge value={step.sla} tone={SLA_TONE[step.sla]} label={t(`workflow.sla.${step.sla}`)} />
                    </div>
                ) : (
                    '—'
                )}
            </TableCell>
            <TableCell>
                <span className="text-sm">{item.startedByName ?? '—'}</span>
                <div className="text-muted-foreground text-xs">
                    {text(item.handlingUnit.name)} · {formatMoment(item.createdAt, { language, calendar })}
                </div>
            </TableCell>
            <TableCell className="text-right">
                <Button asChild size="sm">
                    <Link href={`/cases/${item.id}`}>{t('workflow.action.open')}</Link>
                </Button>
            </TableCell>
        </TableRow>
    );
}
