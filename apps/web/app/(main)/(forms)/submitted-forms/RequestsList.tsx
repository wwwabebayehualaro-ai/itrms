'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSubmissionList, useTemplateList } from '@itrms/form-engine/renderer';
import { Button, InlineStatus, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@itrms/ui';
import { getApiErrorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';

const PAGE_SIZE = 20;

/**
 * The signed-in person's requests across every form (the only list across forms), newest first. Each row opens the
 * request's page; the form name opens that form's data viewer. Paging is by cursor: Next follows the page's cursor,
 * Previous goes back down the stack of cursors already used.
 */
export function RequestsList({ title, description }: { title: string; description: string }) {
    // cursors[i] is the `before` of page i; the first page has none
    const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
    const before = cursors[cursors.length - 1];
    const { data, isPending, error } = useSubmissionList({ mine: true, limit: PAGE_SIZE, before });
    const { data: templates } = useTemplateList();
    const formNames = useMemo(() => new Map((templates ?? []).map((t) => [String(t.id), t.name])), [templates]);
    const next = data?.next ?? null;

    return (
        <div className="flex flex-col gap-4" data-requests-list>
            <div>
                <h1 className="text-2xl font-semibold">{title}</h1>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            {isPending ? (
                <InlineStatus loading />
            ) : error ? (
                <InlineStatus error={getApiErrorMessage(error, 'Could not load the requests')} />
            ) : !data?.items.length ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No requests here yet</p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Request</TableHead>
                            <TableHead>Form</TableHead>
                            <TableHead>Office</TableHead>
                            <TableHead>Submitted</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.items.map((r) => (
                            <TableRow key={String(r.id)}>
                                <TableCell>
                                    <Link
                                        href={`/submitted-forms/template/${r.template_id}/${r.id}`}
                                        className="font-medium text-primary hover:underline"
                                        data-request-link
                                    >
                                        {String(r.id).slice(0, 8)}
                                    </Link>
                                </TableCell>
                                <TableCell>
                                    <Link
                                        href={`/submitted-forms/template/${r.template_id}`}
                                        className="hover:underline"
                                    >
                                        {formNames.get(String(r.template_id)) ?? 'Form'}
                                    </Link>
                                </TableCell>
                                <TableCell>{r.handling_unit_name ?? '—'}</TableCell>
                                <TableCell>{formatDateTime(r.created_at)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    disabled={cursors.length === 1}
                    onClick={() => setCursors((c) => c.slice(0, -1))}
                >
                    Previous
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    disabled={!next}
                    onClick={() => next && setCursors((c) => [...c, next])}
                >
                    Next
                </Button>
            </div>
        </div>
    );
}
