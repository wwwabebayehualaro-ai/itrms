'use client';

/**
 * The workflows (task 0.21c): every workflow the office reads, whose it is, its latest version, and switching one on
 * or off (If-Match: a switched-off workflow starts no case; its service answers "not configured"). A definition is
 * checked by the engine before it is stored: pasted here, its problems are listed in the reader's language.
 */
import { useState } from 'react';
import {
    Badge,
    Button,
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

import { isApiError } from '@/lib/api/client';
import { getApiErrorMessage } from '@/lib/api/errors';
import { useText } from '@/lib/preferences';
import { checkDefinition, useSwitchWorkflow, useWorkflows } from '@/lib/services';

function Check() {
    const { t } = useText();
    const [draft, setDraft] = useState('');
    const [result, setResult] = useState<{
        ok: boolean;
        problems: { code: string; path: string; message: string }[];
    }>();
    const [notJson, setNotJson] = useState(false);
    const [busy, setBusy] = useState(false);
    const run = async () => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(draft);
            setNotJson(false);
        } catch {
            setNotJson(true);
            setResult(undefined);
            return;
        }
        setBusy(true);
        try {
            setResult(await checkDefinition(parsed));
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="flex flex-col gap-3 rounded-md border p-4" data-section="check">
            <div>
                <h2 className="text-lg font-semibold">{t('workflow.definitions.check')}</h2>
                <p className="text-sm text-muted-foreground">{t('workflow.definitions.checkIntro')}</p>
            </div>
            <Label htmlFor="definition" className="sr-only">
                {t('workflow.definitions.check')}
            </Label>
            <Textarea
                id="definition"
                className="min-h-40 font-mono text-xs"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
            />
            <div>
                <Button type="button" onClick={() => void run()} disabled={busy || !draft.trim()}>
                    {t('workflow.definitions.runCheck')}
                </Button>
            </div>
            {notJson && <p className="text-sm text-destructive">{t('workflow.definitions.notJson')}</p>}
            {result?.ok && (
                <p className="text-sm" data-check-ok>
                    {t('workflow.definitions.ok')}
                </p>
            )}
            {result && !result.ok && (
                <ul className="list-disc ps-5 text-sm" data-check-problems>
                    {result.problems.map((p) => (
                        <li key={`${p.code}:${p.path}`}>
                            <span className="font-mono text-xs">{p.path}</span> · {p.message}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export function WorkflowDefinitions() {
    const { t, text } = useText();
    const notify = useNotify();
    const workflows = useWorkflows();
    const switchOver = useSwitchWorkflow();

    const flip = async (id: string, version: number, active: boolean) => {
        try {
            await switchOver.mutateAsync({ id, version, active });
            notify.success(
                t('workflow.definitions.switched', {
                    state: t(active ? 'workflow.definitions.on' : 'workflow.definitions.off')
                })
            );
        } catch (error) {
            notify.error(
                isApiError(error) && error.response?.status === 409
                    ? t('workflow.definitions.changed')
                    : getApiErrorMessage(error)
            );
        }
    };

    return (
        <div className="flex flex-col gap-6" data-screen="workflows">
            <PageHeader title={t('workflow.definitions.title')} description={t('workflow.definitions.intro')} />
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('workflow.definitions.name')}</TableHead>
                        <TableHead>{t('workflow.definitions.owner')}</TableHead>
                        <TableHead>{t('workflow.definitions.latest')}</TableHead>
                        <TableHead>{t('workflow.definitions.active')}</TableHead>
                        <TableHead />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {workflows.isPending && (
                        <TableRow>
                            <TableCell colSpan={5}>
                                <Skeleton className="h-6 w-full" />
                            </TableCell>
                        </TableRow>
                    )}
                    {workflows.data?.map((w) => (
                        <TableRow key={w.id} data-workflow={w.key}>
                            <TableCell>
                                <div className="font-medium">{text(w.name)}</div>
                                <div className="font-mono text-xs text-muted-foreground">{w.key}</div>
                            </TableCell>
                            <TableCell>{text(w.ownerUnit.name)}</TableCell>
                            <TableCell>{w.latestVersion?.number ?? '—'}</TableCell>
                            <TableCell>
                                <Badge variant={w.active ? 'default' : 'outline'} data-active={w.active}>
                                    {t(w.active ? 'workflow.definitions.on' : 'workflow.definitions.off')}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={switchOver.isPending}
                                    onClick={() => void flip(w.id, w.version, !w.active)}
                                >
                                    {t(w.active ? 'workflow.definitions.switchOff' : 'workflow.definitions.switchOn')}
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {workflows.data?.length === 0 && <EmptyState title={t('workflow.definitions.none')} />}
            {workflows.error && <p className="text-sm text-destructive">{getApiErrorMessage(workflows.error)}</p>}
            <Check />
        </div>
    );
}
