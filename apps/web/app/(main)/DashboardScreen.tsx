'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
    ArrowRight,
    CheckSquare,
    FilePlus2,
    FileText,
    Inbox,
    LayoutTemplate,
    Send,
    User,
    type LucideIcon
} from 'lucide-react';
import { useSubmissionList, useVisibleTemplates } from '@itrms/form-engine/renderer';
import { StatusTag } from '@itrms/form-engine/viewer';
import { Button, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@itrms/ui';
import { useApprovals } from '@/lib/approval';
import { useCan } from '@/lib/auth/authHooks';
import { useAuthStore } from '@/lib/auth/authStore';
import { useDirectory } from '@/lib/auth/directory';
import { formatDateTime } from '@/lib/format';

const greeting = (h: number) => (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');

/** The start page: what waits for the user (requests, approvals), the latest requests and the forms they can start. */
export function DashboardScreen() {
    const user = useAuthStore((s) => s.user);
    const canRead = useCan('submission:read');
    const canStart = useCan('submission:create');
    const canBuild = useCan('template:create');
    const [hour] = useState(() => new Date().getHours());

    const forms = useVisibleTemplates();
    const published = useMemo(() => (forms.data ?? []).filter((t) => t.status === 'published'), [forms.data]);
    const waiting = useSubmissionList({ status: 'submitted', page: 1, pageSize: 1 }, { enabled: canRead });
    const mine = useSubmissionList({ mine: true, page: 1, pageSize: 1 }, { enabled: canRead });
    const latest = useSubmissionList({ page: 1, pageSize: 6, sort: '-created_at' }, { enabled: canRead });
    const approvals = useApprovals({ scope: 'to_decide', status: 'pending', page_size: 1 });
    const { names } = useDirectory();
    const formName = useMemo(() => new Map((forms.data ?? []).map((t) => [String(t.id), t.name])), [forms.data]);

    return (
        <div className="flex flex-col gap-6" data-dashboard>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">
                        {greeting(hour)}
                        {user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Here is what is going on in your forms and requests.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {canBuild && (
                        <Button asChild variant="outline">
                            <Link href="/dynamic-template/builder">
                                <LayoutTemplate />
                                New form
                            </Link>
                        </Button>
                    )}
                    {canStart && (
                        <Button asChild>
                            <Link href="/maker/form-intiator">
                                <FilePlus2 />
                                Start a request
                            </Link>
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                <Stat
                    label="Published forms"
                    icon={FileText}
                    href="/dynamic-template/saved-templates"
                    value={forms.data ? published.length : undefined}
                    hint={forms.data ? `${forms.data.length} in all` : undefined}
                />
                {canRead && (
                    <Stat
                        label="Waiting requests"
                        icon={Inbox}
                        href="/submitted-forms/status/submitted"
                        value={waiting.data?.total}
                        hint="status submitted, every form"
                    />
                )}
                {canRead && (
                    <Stat
                        label="My requests"
                        icon={User}
                        href="/submitted-forms/filter/my-submissions"
                        value={mine.data?.total}
                        hint="submitted by you"
                    />
                )}
                <Stat
                    label="Approvals to decide"
                    icon={CheckSquare}
                    href="/approvals"
                    value={approvals.data?.total}
                    hint="waiting for your decision"
                />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                {canRead && (
                    <Card data-dashboard-latest>
                        <CardHeader>
                            <CardTitle>Latest requests</CardTitle>
                            <CardDescription>The newest requests of every form</CardDescription>
                            <CardAction>
                                <Button asChild variant="ghost" size="sm">
                                    <Link href="/submitted-forms/filter/recent">
                                        All recent
                                        <ArrowRight />
                                    </Link>
                                </Button>
                            </CardAction>
                        </CardHeader>
                        <CardContent>
                            {latest.isPending ? (
                                <Rows />
                            ) : latest.data?.items.length ? (
                                <ul className="divide-y">
                                    {latest.data.items.map((s) => (
                                        <li key={String(s.id)}>
                                            <Link
                                                href={`/submitted-forms/template/${s.template_id}/${s.id}`}
                                                className="flex items-center gap-3 py-2.5 hover:bg-muted/50 -mx-2 rounded-md px-2"
                                            >
                                                <Send className="size-4 shrink-0 text-muted-foreground" />
                                                <span className="flex min-w-0 flex-1 flex-col">
                                                    <span className="truncate text-sm font-medium">
                                                        {formName.get(String(s.template_id)) ?? 'Form'}
                                                    </span>
                                                    <span className="truncate text-xs text-muted-foreground">
                                                        {(s.submitted_by && names.get(String(s.submitted_by))) ||
                                                            'Someone'}{' '}
                                                        · {formatDateTime(s.created_at)}
                                                    </span>
                                                </span>
                                                <StatusTag value={s.status} />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="py-6 text-center text-sm text-muted-foreground">No requests yet.</p>
                            )}
                        </CardContent>
                    </Card>
                )}
                <Card data-dashboard-forms>
                    <CardHeader>
                        <CardTitle>Forms</CardTitle>
                        <CardDescription>
                            {canRead ? 'Open a form to see its requests' : 'The forms you can fill in'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {forms.isPending ? (
                            <Rows />
                        ) : published.length ? (
                            <ul className="divide-y">
                                {published.slice(0, 8).map((t) => (
                                    <li key={String(t.id)}>
                                        <Link
                                            href={
                                                canRead ? `/submitted-forms/template/${t.id}` : '/maker/form-intiator'
                                            }
                                            className="flex items-center gap-3 py-2.5 hover:bg-muted/50 -mx-2 rounded-md px-2"
                                        >
                                            <FileText className="size-4 shrink-0 text-primary" />
                                            <span className="flex-1 truncate text-sm font-medium">{t.name}</span>
                                            {t.category && (
                                                <span className="text-xs text-muted-foreground">{t.category}</span>
                                            )}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="py-6 text-center text-sm text-muted-foreground">No published forms yet.</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function Stat({
    label,
    icon: Icon,
    href,
    value,
    hint
}: {
    label: string;
    icon: LucideIcon;
    href: string;
    value?: number;
    hint?: string;
}) {
    return (
        <Link
            href={href}
            className="group rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-stat={label}
        >
            <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardHeader>
                    <CardDescription>{label}</CardDescription>
                    <CardTitle className="text-3xl tabular-nums">
                        {value ?? <Skeleton className="h-8 w-12" />}
                    </CardTitle>
                    <CardAction>
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="size-4" />
                        </span>
                    </CardAction>
                </CardHeader>
                {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
            </Card>
        </Link>
    );
}

function Rows() {
    return (
        <div className="flex flex-col gap-3 py-1">
            {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
            ))}
        </div>
    );
}
