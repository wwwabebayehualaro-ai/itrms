'use client';

import * as React from 'react';
import { z } from 'zod';
import { Check, Inbox, Undo2, X } from 'lucide-react';
import {
    useApprovalActions,
    useApprovals,
    usePublicationReview,
    type Approval,
    type ApprovalScope,
    type ApprovalStatus
} from '@/lib/approval';
import { useCan } from '@/lib/auth/authHooks';
import { getApiErrorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { useText } from '@/lib/preferences';
import { PublishReview, type PublishCheck } from '@itrms/form-engine/designer';
import { Alert, AlertDescription, AlertTitle } from '@itrms/ui';
import { Button } from '@itrms/ui';
import { Card, CardContent } from '@itrms/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@itrms/ui';
import { Separator } from '@itrms/ui';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@itrms/ui';
import { Skeleton } from '@itrms/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@itrms/ui';
import { Tabs, TabsList, TabsTrigger } from '@itrms/ui';
import { useZodForm, ZodForm } from '@itrms/ui';
import { ApprovalStatusTag } from './ApprovalStatusTag';

const PAGE_SIZE = 20;

/** The approvals inbox: requests waiting for the user's decision, the user's own requests, and (admins) everything. */
export function ApprovalInbox() {
    const { t } = useText();
    // who may decide sees every request of the unit's view
    const canSeeAll = useCan('form:approve');
    const [scope, setScope] = React.useState<ApprovalScope>('to_decide');
    const [status, setStatus] = React.useState<ApprovalStatus>('pending');
    // the cursors of the pages before this one (the server pages, task 0.20d)
    const [cursors, setCursors] = React.useState<string[]>([]);
    const [openId, setOpenId] = React.useState<string | null>(null);

    const { data, isPending, isFetching, error } = useApprovals({
        scope,
        status,
        after: cursors[cursors.length - 1] ?? null,
        page_size: PAGE_SIZE
    });
    const open = data?.items.find((a) => a.id === openId) ?? null;
    const page = cursors.length + 1;

    return (
        <div className="flex flex-col gap-4" data-slot="screen">
            <div>
                <h1 className="text-2xl font-semibold">{t('shell.approvals.title')}</h1>
                <p className="text-muted-foreground text-sm">{t('shell.approvals.intro')}</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                    value={scope}
                    onValueChange={(v) => {
                        setScope(v as ApprovalScope);
                        setCursors([]);
                    }}
                >
                    <TabsList>
                        <TabsTrigger value="to_decide">{t('shell.approvals.tab.toDecide')}</TabsTrigger>
                        <TabsTrigger value="mine">{t('common.label.myRequests')}</TabsTrigger>
                        {canSeeAll && <TabsTrigger value="all">{t('shell.approvals.tab.all')}</TabsTrigger>}
                    </TabsList>
                </Tabs>
                {scope !== 'to_decide' && (
                    <Select
                        value={status}
                        onValueChange={(v) => {
                            setStatus(v as ApprovalStatus);
                            setCursors([]);
                        }}
                    >
                        <SelectTrigger className="w-44" aria-label={t('common.label.status')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="pending">{t('shell.approvals.status.pending')}</SelectItem>
                            <SelectItem value="approved">{t('shell.approvals.status.approved')}</SelectItem>
                            <SelectItem value="rejected">{t('shell.approvals.status.rejected')}</SelectItem>
                            <SelectItem value="cancelled">{t('shell.approvals.status.cancelled')}</SelectItem>
                        </SelectContent>
                    </Select>
                )}
            </div>

            {error ? (
                <Alert variant="destructive">
                    <AlertTitle>{t('shell.approvals.loadFailed')}</AlertTitle>
                    <AlertDescription>{getApiErrorMessage(error)}</AlertDescription>
                </Alert>
            ) : (
                <Card className="py-0">
                    <CardContent className="px-0">
                        <Table aria-busy={isFetching || undefined}>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-6">{t('common.label.request')}</TableHead>
                                    <TableHead>{t('shell.approvals.col.requestedBy')}</TableHead>
                                    <TableHead>{t('shell.approvals.col.when')}</TableHead>
                                    <TableHead>{t('common.label.status')}</TableHead>
                                    <TableHead className="pr-6 text-right">
                                        <span className="sr-only">{t('common.action.open')}</span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isPending &&
                                    Array.from({ length: 3 }, (_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={5} className="px-6">
                                                <Skeleton className="h-6 w-full" />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                {data?.items.map((a) => (
                                    <TableRow
                                        key={a.id}
                                        data-approval={a.id}
                                        className="cursor-pointer"
                                        onClick={() => setOpenId(a.id)}
                                    >
                                        <TableCell className="pl-6 whitespace-normal">
                                            <div className="font-medium">{a.title}</div>
                                            <div className="text-muted-foreground text-xs">{a.policy_title}</div>
                                        </TableCell>
                                        <TableCell>{a.requested_by_name ?? t('common.label.unknown')}</TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {formatDateTime(a.created_at)}
                                        </TableCell>
                                        <TableCell>
                                            <ApprovalStatusTag status={a.status} />
                                        </TableCell>
                                        <TableCell className="pr-6 text-right">
                                            <Button
                                                variant={a.can_decide ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={(e) => (e.stopPropagation(), setOpenId(a.id))}
                                            >
                                                {a.can_decide ? t('shell.approvals.review') : t('common.action.open')}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {data && data.items.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="py-10">
                                            <div className="text-muted-foreground flex flex-col items-center gap-2">
                                                <Inbox className="size-8" aria-hidden />
                                                {scope === 'to_decide'
                                                    ? t('shell.approvals.empty.toDecide')
                                                    : t('shell.approvals.empty.none')}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {data && (data.next || page > 1) && (
                <div className="flex items-center justify-end gap-2 text-sm" data-approvals-pager>
                    <span className="text-muted-foreground">{t('shell.approvals.page', { page: String(page) })}</span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setCursors((c) => c.slice(0, -1))}
                    >
                        {t('common.action.previous')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!data.next}
                        onClick={() => {
                            const next = data.next;
                            if (next) setCursors((c) => [...c, next]);
                        }}
                    >
                        {t('common.action.next')}
                    </Button>
                </div>
            )}

            <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
                <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
                    {open && <ApprovalDetail approval={open} onDone={() => setOpenId(null)} />}
                </SheetContent>
            </Sheet>
        </div>
    );
}

// `note`, as the API names it: a 422 on it shows on the field
const decisionSchema = (t: (key: string, values?: Record<string, string>) => string) =>
    z.object({ note: z.string().max(500, t('common.validation.maxChars', { max: '500' })) });

function ApprovalDetail({ approval: a, onDone }: { approval: Approval; onDone: () => void }) {
    const { t } = useText();
    const { approve, reject, cancel } = useApprovalActions();
    const schema = React.useMemo(() => decisionSchema(t), [t]);
    const review = usePublicationReview<PublishCheck>(a.id);
    // which button submitted (a ref: the submit runs before a state update would re-render)
    const action = React.useRef<'approve' | 'reject'>('approve');
    const form = useZodForm({
        schema,
        defaultValues: { note: '' },
        // a rejection without a reason comes back as a 422 on `note` and is shown on the field
        onSubmit: async ({ note: comment }) => {
            if (action.current === 'approve')
                await approve.mutateAsync({ id: a.id, comment, row_version: a.row_version });
            else await reject.mutateAsync({ id: a.id, comment, row_version: a.row_version });
            onDone();
        }
    });

    return (
        <>
            <SheetHeader>
                <SheetTitle>{a.title}</SheetTitle>
                <SheetDescription>{a.policy_title}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 text-sm">
                <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2">
                    <dt className="text-muted-foreground">{t('common.label.status')}</dt>
                    <dd>
                        <ApprovalStatusTag status={a.status} />
                    </dd>
                    <dt className="text-muted-foreground">{t('shell.approvals.detail.requestedBy')}</dt>
                    <dd>{a.requested_by_name ?? t('common.label.unknown')}</dd>
                    <dt className="text-muted-foreground">{t('shell.approvals.detail.requested')}</dt>
                    <dd>{formatDateTime(a.created_at)}</dd>
                    {a.note && (
                        <>
                            <dt className="text-muted-foreground">{t('shell.approvals.detail.note')}</dt>
                            <dd className="whitespace-pre-wrap">{a.note}</dd>
                        </>
                    )}
                    {a.decided_at && (
                        <>
                            <dt className="text-muted-foreground">
                                {a.status === 'cancelled'
                                    ? t('shell.approvals.status.cancelled')
                                    : t('shell.approvals.detail.decidedBy')}
                            </dt>
                            <dd>
                                {a.decided_by_name ?? t('common.label.unknown')}, {formatDateTime(a.decided_at)}
                            </dd>
                        </>
                    )}
                    {a.comment && (
                        <>
                            <dt className="text-muted-foreground">{t('shell.approvals.detail.comment')}</dt>
                            <dd className="whitespace-pre-wrap">{a.comment}</dd>
                        </>
                    )}
                </dl>
                {review.isPending && <Skeleton className="h-24 w-full" />}
                {review.data && <PublishReview check={review.data} />}
                {a.can_decide && (
                    <>
                        <Separator />
                        <ZodForm form={form}>
                            <form.AppField name="note">
                                {(f) => (
                                    <f.TextareaField
                                        label={t('shell.approvals.detail.comment')}
                                        description={t('shell.approvals.decision.hint')}
                                        rows={3}
                                    />
                                )}
                            </form.AppField>
                            <form.AppForm>
                                <div className="flex gap-2">
                                    <form.SubmitButton onClick={() => (action.current = 'approve')}>
                                        <Check /> {t('shell.approvals.decision.approve')}
                                    </form.SubmitButton>
                                    <form.SubmitButton variant="outline" onClick={() => (action.current = 'reject')}>
                                        <X /> {t('shell.approvals.decision.reject')}
                                    </form.SubmitButton>
                                </div>
                            </form.AppForm>
                        </ZodForm>
                    </>
                )}
            </div>
            {a.can_cancel && (
                <SheetFooter>
                    <Button
                        variant="outline"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate({ id: a.id, row_version: a.row_version }, { onSuccess: onDone })}
                    >
                        <Undo2 /> {t('shell.approvals.decision.withdraw')}
                    </Button>
                </SheetFooter>
            )}
        </>
    );
}
