'use client';

/**
 * A form's versions: who saved each, which one is live, what changed between any two (or against the working copy), and a
 * way back. Going back loads an old version as an unsaved edit that still holds every published key (`keepPublishedKeys`);
 * saving it and asking for a publication then goes through the same check and approval as any change.
 */
import { useId, useMemo, useState } from 'react';
import { History as HistoryIcon, RotateCcw } from 'lucide-react';
import {
    Badge,
    Button,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    Spinner
} from '@itrms/ui';

import { diffDocuments, keepPublishedKeys } from '../core';
import { usePublishedTemplate, useVersion, useVersions } from '../api/templates';
import { formatDateTime } from '../host/format';
import { useEngineText } from '../host/text';
import { fromStored, toStored } from './document';
import { DiffView } from './PublishReview';
import { useDesigner, useDesignerActions } from './store';

/** The "version" entry of the pickers that stands for the form as it is in the builder. */
const WORKING = 'working';

export function HistorySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const { t } = useEngineText();
    const actions = useDesignerActions();
    const templateId = useDesigner((s) => s.template.id);
    const doc = useDesigner((s) => s.doc);
    const versions = useVersions(templateId, open);
    const published = usePublishedTemplate(templateId).data;
    const list = useMemo(() => versions.data ?? [], [versions.data]);
    // default: the live version against the working copy
    const [pickedFrom, setFrom] = useState<string | null>(null);
    const [to, setTo] = useState<string>(WORKING);
    const liveId = list.find((v) => v.published)?.id ?? list[0]?.id ?? null;
    const from = pickedFrom ?? liveId;
    const fromVersion = useVersion(templateId, from);
    const toVersion = useVersion(templateId, to === WORKING ? null : to);
    const fromId = useId();
    const toId = useId();

    const diff = useMemo(() => {
        const a = fromVersion.data?.document;
        const b = to === WORKING ? toStored(doc) : toVersion.data?.document;
        return a !== undefined && b !== undefined ? diffDocuments(a, b) : null;
    }, [fromVersion.data, toVersion.data, to, doc]);

    const number = list.find((v) => v.id === from)?.number;
    const restore = () => {
        const document = fromVersion.data?.document;
        if (document === undefined) return;
        const kept = published ? keepPublishedKeys(document, published.form_config) : document;
        actions.replace(fromStored(kept).doc);
        onOpenChange(false);
    };
    const options = (
        <>
            {list.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                    {t('form-engine.designer.history.version', { number: v.number })}
                </SelectItem>
            ))}
        </>
    );
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
                <SheetHeader>
                    <SheetTitle>{t('form-engine.designer.history.title')}</SheetTitle>
                    <SheetDescription>{t('form-engine.designer.history.description')}</SheetDescription>
                </SheetHeader>
                <div className="grid gap-4 px-4 pb-4" data-history>
                    {versions.isPending && <Spinner />}
                    {versions.isSuccess && list.length === 0 && (
                        <p className="text-sm text-muted-foreground">{t('form-engine.designer.history.empty')}</p>
                    )}
                    <ul className="grid gap-1 text-sm">
                        {list.map((v) => (
                            <li key={v.id} className="flex flex-wrap items-center gap-2" data-version={v.number}>
                                <span className="font-medium">
                                    {t('form-engine.designer.history.version', { number: v.number })}
                                </span>
                                {v.published && <Badge>{t('form-engine.designer.history.live')}</Badge>}
                                <span className="text-muted-foreground">
                                    {v.createdByName
                                        ? t('form-engine.designer.history.savedBy', {
                                              name: v.createdByName,
                                              date: formatDateTime(v.createdAt, '')
                                          })
                                        : formatDateTime(v.createdAt, '')}
                                </span>
                                {v.publishedAt && (
                                    <span className="text-muted-foreground">
                                        {t('form-engine.designer.history.publishedAt', {
                                            date: formatDateTime(v.publishedAt, '')
                                        })}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                    {list.length > 0 && (
                        <>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="grid gap-1">
                                    <Label htmlFor={fromId}>{t('form-engine.designer.history.compare')}</Label>
                                    <Select value={from ?? undefined} onValueChange={setFrom}>
                                        <SelectTrigger id={fromId}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>{options}</SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-1">
                                    <Label htmlFor={toId}>{t('form-engine.designer.history.with')}</Label>
                                    <Select value={to} onValueChange={setTo}>
                                        <SelectTrigger id={toId}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={WORKING}>
                                                {t('form-engine.designer.history.working')}
                                            </SelectItem>
                                            {options}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {diff ? <DiffView diff={diff} /> : <Spinner />}
                            <div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={fromVersion.data === undefined || number === undefined}
                                    onClick={restore}
                                    data-restore-version
                                >
                                    <RotateCcw />
                                    {t('form-engine.designer.history.restore', { number: number ?? 0 })}
                                </Button>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    <HistoryIcon className="me-1 inline size-3" aria-hidden />
                                    {t('form-engine.designer.history.restoreHelp')}
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
