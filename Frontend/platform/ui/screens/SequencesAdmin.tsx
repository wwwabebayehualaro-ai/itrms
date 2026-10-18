'use client';

import { useSequences } from '@platform/lib/numbering';
import { getApiErrorMessage } from '@platform/lib/api/errors';
import { Alert, AlertDescription, AlertTitle } from '../primitives/alert';
import { Badge } from '../primitives/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card';
import { Skeleton } from '../primitives/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table';

const RESET: Record<string, string> = { never: 'Never', yearly: 'Every year', monthly: 'Every month' };

/** Admin screen (read-only): the document number sequences modules declared and the number each will issue next. */
export function SequencesAdmin() {
    const { data, isPending, error } = useSequences();
    return (
        <div className="flex flex-col gap-4" data-slot="screen">
            <div>
                <h1 className="text-2xl font-semibold">Document numbers</h1>
                <p className="text-muted-foreground text-sm">Numbers are issued by the server when a document is saved: per organization, without gaps.</p>
            </div>
            {error ? (
                <Alert variant="destructive">
                    <AlertTitle>Sequences could not be loaded</AlertTitle>
                    <AlertDescription>{getApiErrorMessage(error)}</AlertDescription>
                </Alert>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Sequences</CardTitle>
                        <CardDescription>Declared by the modules in code; a new period (year, month) starts again at 1.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Sequence</TableHead>
                                    <TableHead>Pattern</TableHead>
                                    <TableHead>Restarts</TableHead>
                                    <TableHead className="text-right">Next number</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isPending && (
                                    <TableRow>
                                        <TableCell colSpan={4}>
                                            <Skeleton className="h-6 w-full" />
                                        </TableCell>
                                    </TableRow>
                                )}
                                {data?.map((s) => (
                                    <TableRow key={s.key} data-sequence={s.key}>
                                        <TableCell>
                                            <div className="font-medium">{s.title}</div>
                                            <div className="text-muted-foreground font-mono text-xs">{s.key}</div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{s.pattern}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{RESET[s.reset] ?? s.reset}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-mono">{s.next_number}</TableCell>
                                    </TableRow>
                                ))}
                                {data?.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-muted-foreground py-6 text-center">
                                            No module declares a document number sequence yet.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
