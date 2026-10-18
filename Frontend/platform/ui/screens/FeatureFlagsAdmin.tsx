'use client';

import * as React from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { useFeatureFlagsAdmin, useSetFeatureFlag, type FeatureFlag } from '@platform/lib/modules';
import { Alert, AlertDescription, AlertTitle } from '../primitives/alert';
import { Badge } from '../primitives/badge';
import { Button } from '../primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card';
import { Input } from '../primitives/input';
import { Skeleton } from '../primitives/skeleton';
import { Switch } from '../primitives/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip';
import { getApiErrorMessage } from '@platform/lib/api/errors';

/** Admin screen: switch modules and features on or off for the tenant (`feature_flag:read` / `feature_flag:update`). */
export function FeatureFlagsAdmin() {
    const { data, isPending, error } = useFeatureFlagsAdmin();
    const setFlag = useSetFeatureFlag();
    const [query, setQuery] = React.useState('');

    const rows = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        return (data ?? []).filter((f) => !q || f.key.toLowerCase().includes(q) || f.description.toLowerCase().includes(q));
    }, [data, query]);
    const pendingKey = setFlag.isPending ? setFlag.variables?.key : undefined;

    return (
        <div className="flex flex-col gap-4" data-slot="screen">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Feature flags</h1>
                    <p className="text-muted-foreground text-sm">Switch modules and features on or off for your organization. Changes apply immediately to everyone.</p>
                </div>
                <div className="relative w-full sm:w-72">
                    <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
                    <Input className="pl-8" placeholder="Search flags" aria-label="Search flags" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
            </div>

            {error ? (
                <Alert variant="destructive">
                    <AlertTitle>Feature flags could not be loaded</AlertTitle>
                    <AlertDescription>{getApiErrorMessage(error)}</AlertDescription>
                </Alert>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Modules and features</CardTitle>
                        <CardDescription>A module that is off disappears from the menu and its API answers “not enabled”. Modules that others depend on switch those off too.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Flag</TableHead>
                                    <TableHead className="w-28">Type</TableHead>
                                    <TableHead className="w-28">Default</TableHead>
                                    <TableHead className="w-40">State</TableHead>
                                    <TableHead className="w-24 text-right">
                                        <span className="sr-only">Actions</span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isPending
                                    ? Array.from({ length: 4 }, (_, i) => (
                                          <TableRow key={i}>
                                              <TableCell colSpan={5}>
                                                  <Skeleton className="h-6 w-full" />
                                              </TableCell>
                                          </TableRow>
                                      ))
                                    : rows.map((flag) => <FlagRow key={flag.key} flag={flag} busy={pendingKey === flag.key} onChange={(enabled) => setFlag.mutate({ key: flag.key, enabled })} />)}
                                {!isPending && rows.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                                            No flags match “{query}”.
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

function FlagRow({ flag, busy, onChange }: { flag: FeatureFlag; busy: boolean; onChange: (enabled: boolean | null) => void }) {
    const id = `flag-${flag.key}`;
    return (
        <TableRow data-flag={flag.key}>
            <TableCell className="whitespace-normal">
                <label htmlFor={id} className="font-medium">
                    {flag.description || flag.key}
                </label>
                <div className="text-muted-foreground font-mono text-xs">{flag.key}</div>
            </TableCell>
            <TableCell>
                <Badge variant={flag.kind === 'module' ? 'secondary' : 'outline'}>{flag.kind === 'module' ? 'Module' : 'Feature'}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{flag.default ? 'On' : 'Off'}</TableCell>
            <TableCell>
                <div className="flex items-center gap-2">
                    <Switch id={id} checked={flag.enabled} disabled={flag.locked || busy} onCheckedChange={(v) => onChange(v)} aria-describedby={`${id}-state`} />
                    <span id={`${id}-state`} className="text-sm">
                        {flag.locked ? 'Always on' : flag.enabled ? 'On' : 'Off'}
                    </span>
                    {flag.overridden && <Badge variant="outline">Changed</Badge>}
                </div>
            </TableCell>
            <TableCell className="text-right">
                {flag.overridden && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => onChange(null)} aria-label={`Reset ${flag.key} to its default`}>
                                <RotateCcw />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Back to the default ({flag.default ? 'on' : 'off'})</TooltipContent>
                    </Tooltip>
                )}
            </TableCell>
        </TableRow>
    );
}
