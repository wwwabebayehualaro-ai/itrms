'use client';

import * as React from 'react';
import { z } from 'zod';
import { Check, Inbox, Undo2, X } from 'lucide-react';
import {
    useApprovalActions,
    useApprovals,
    type Approval,
    type ApprovalScope,
    type ApprovalStatus
} from '@/lib/approval';
import { useCan } from '@/lib/auth/authHooks';
import { getApiErrorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
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
const ALL = 'any';

/** The approvals inbox: requests waiting for the user's decision, the user's own requests, and (admins) everything. */
export function ApprovalInbox() {
    const canSeeAll = useCan('approval:read');
    const [scope, setScope] = React.useState<ApprovalScope>('to_decide');
    const [status, setStatus] = React.useState<ApprovalStatus | typeof ALL>(ALL);
    const [page, setPage] = React.useState(1);
    const [openId, setOpenId] = React.useState<string | null>(null);

    const { data, isPending, isFetching, error } = useApprovals({
        scope,
        status: status === ALL ? undefined : status,
        page,
        page_size: PAGE_SIZE
    });
    const open = data?.items.find((a) => a.id === openId) ?? null;
    const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

    return (
        <div className="flex flex-col gap-4" data-slot="screen">
            <div>
                <h1 className="text-2xl font-semibold">Approvals</h1>
                <p className="text-muted-foreground text-sm">
                    Changes that need a second person’s decision. You never decide your own requests.
                </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                    value={scope}
                    onValueChange={(v) => {
                        setScope(v as ApprovalScope);
                        setPage(1);
                    }}
                >
                    <TabsList>
                        <TabsTrigger value="to_decide">To decide</TabsTrigger>
                        <TabsTrigger value="mine">My requests</TabsTrigger>
                        {canSeeAll && <TabsTrigger value="all">All</TabsTrigger>}
                    </TabsList>
                </Tabs>
                {scope !== 'to_decide' && (
                    <Select
                        value={status}
                        onValueChange={(v) => {
                            setStatus(v as ApprovalStatus | typeof ALL);
                            setPage(1);
                        }}
                    >
                        <SelectTrigger className="w-44" aria-label="Status">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>Any status</SelectItem>
                            <SelectItem value="pending">Waiting</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                            <SelectItem value="cancelled">Withdrawn</SelectItem>
                        </SelectContent>
                    </Select>
                )}
            </div>

            {error ? (
                <Alert variant="destructive">
                    <AlertTitle>Approvals could not be loaded</AlertTitle>
                    <AlertDescription>{getApiErrorMessage(error)}</AlertDescription>
                </Alert>
            ) : (
                <Card className="py-0">
                    <CardContent className="px-0">
                        <Table aria-busy={isFetching || undefined}>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="pl-6">Request</TableHead>
                                    <TableHead>Requested by</TableHead>
                                    <TableHead>When</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="pr-6 text-right">
                                        <span className="sr-only">Open</span>
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
                                        <TableCell>{a.requested_by_name ?? 'Unknown'}</TableCell>
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
                                                {a.can_decide ? 'Review' : 'Open'}
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
                                                    ? 'Nothing is waiting for your decision.'
                                                    : 'No requests.'}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {data && data.total > PAGE_SIZE && (
                <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">
                        Page {page} of {pages}
                    </span>
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                        Next
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

const decisionSchema = z.object({ comment: z.string().max(2000, 'At most 2000 characters') });

function ApprovalDetail({ approval: a, onDone }: { approval: Approval; onDone: () => void }) {
    const { approve, reject, cancel } = useApprovalActions();
    // which button submitted (a ref: the submit runs before a state update would re-render)
    const action = React.useRef<'approve' | 'reject'>('approve');
    const form = useZodForm({
        schema: decisionSchema,
        defaultValues: { comment: '' },
        // a rejection without a reason comes back as a 422 on `comment` and is shown on the field
        onSubmit: async ({ comment }) => {
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
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                        <ApprovalStatusTag status={a.status} />
                    </dd>
                    <dt className="text-muted-foreground">Requested by</dt>
                    <dd>{a.requested_by_name ?? 'Unknown'}</dd>
                    <dt className="text-muted-foreground">Requested</dt>
                    <dd>{formatDateTime(a.created_at)}</dd>
                    {a.note && (
                        <>
                            <dt className="text-muted-foreground">Note</dt>
                            <dd className="whitespace-pre-wrap">{a.note}</dd>
                        </>
                    )}
                    {a.decided_at && (
                        <>
                            <dt className="text-muted-foreground">
                                {a.status === 'cancelled' ? 'Withdrawn' : 'Decided by'}
                            </dt>
                            <dd>
                                {a.decided_by_name ?? 'Unknown'}, {formatDateTime(a.decided_at)}
                            </dd>
                        </>
                    )}
                    {a.comment && (
                        <>
                            <dt className="text-muted-foreground">Comment</dt>
                            <dd className="whitespace-pre-wrap">{a.comment}</dd>
                        </>
                    )}
                </dl>
                {a.payload && Object.keys(a.payload).length > 0 && (
                    <>
                        <Separator />
                        <div>
                            <div className="mb-2 font-medium">Details</div>
                            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
                                {Object.entries(a.payload).map(([k, v]) => (
                                    <React.Fragment key={k}>
                                        <dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
                                        <dd className="break-words">
                                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                        </dd>
                                    </React.Fragment>
                                ))}
                            </dl>
                        </div>
                    </>
                )}
                {a.can_decide && (
                    <>
                        <Separator />
                        <ZodForm form={form}>
                            <form.AppField name="comment">
                                {(f) => (
                                    <f.TextareaField
                                        label="Comment"
                                        description="Optional when approving, required when rejecting."
                                        rows={3}
                                    />
                                )}
                            </form.AppField>
                            <form.AppForm>
                                <div className="flex gap-2">
                                    <form.SubmitButton onClick={() => (action.current = 'approve')}>
                                        <Check /> Approve
                                    </form.SubmitButton>
                                    <form.SubmitButton variant="outline" onClick={() => (action.current = 'reject')}>
                                        <X /> Reject
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
                        <Undo2 /> Withdraw request
                    </Button>
                </SheetFooter>
            )}
        </>
    );
}
