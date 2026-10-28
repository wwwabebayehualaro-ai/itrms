'use client';

/**
 * The home page's "my tasks" widget (task 0.20d, a role workspace's first widget): how many steps wait for the person in
 * their office, how many are overdue or taken on by nobody, and the most urgent few, each opening its case.
 */
import Link from 'next/link';
import { ArrowRight, Inbox as InboxIcon } from 'lucide-react';
import {
    Button,
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Skeleton,
    StatusBadge,
    type Tone
} from '@itrms/ui';

import { useText } from '@/lib/preferences';
import { useInbox, type SlaState } from '@/lib/workflow';
import { useTaskCount } from '@/lib/workspace';

const SLA_TONE: Record<SlaState, Tone> = {
    none: 'muted',
    'on-time': 'success',
    'due-soon': 'warning',
    overdue: 'danger'
};
const SHOWN = 5;

export function MyTasksWidget() {
    const { t, text } = useText();
    const count = useTaskCount();
    const inbox = useInbox({}, null);
    const items = inbox.data?.items.slice(0, SHOWN) ?? [];
    return (
        <Card data-widget="my-tasks">
            <CardHeader>
                <CardTitle>{t('workflow.widget.title')}</CardTitle>
                <CardDescription>
                    {count.data
                        ? t('workflow.widget.counts', {
                              open: String(count.data.open),
                              overdue: String(count.data.overdue),
                              unclaimed: String(count.data.unclaimed)
                          })
                        : t('workflow.widget.intro')}
                </CardDescription>
                <CardAction>
                    <Button asChild variant="ghost" size="sm">
                        <Link href="/inbox">
                            {t('workflow.widget.all')}
                            <ArrowRight />
                        </Link>
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent>
                {inbox.isPending ? (
                    <Skeleton className="h-24 w-full" />
                ) : items.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">{t('workflow.inbox.empty')}</p>
                ) : (
                    <ul className="divide-y">
                        {items.map((item) => (
                            <li key={item.taskId} data-widget-task={item.caseNumber}>
                                <Link
                                    href={`/cases/${item.caseId}`}
                                    className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50"
                                >
                                    <InboxIcon className="size-4 shrink-0 text-muted-foreground" />
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-sm font-medium">
                                            {t('workflow.case.number', { number: String(item.caseNumber) })} ·{' '}
                                            {item.stateLabel ? text(item.stateLabel) : item.state}
                                        </span>
                                        <span className="truncate text-xs text-muted-foreground">
                                            {text(item.workflow.name)}
                                        </span>
                                    </span>
                                    <StatusBadge
                                        value={item.sla}
                                        tone={SLA_TONE[item.sla]}
                                        label={t(`workflow.sla.${item.sla}`)}
                                    />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
