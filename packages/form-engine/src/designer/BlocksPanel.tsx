'use client';

/**
 * Blocks in the builder (task 1.13d): the published blocks offered in the palette (a click copies the block's published version
 * into the form as a section), and, on a block's section, which block and version it holds, with an update to a newer published
 * version. The copy is the form's own: the update is the author's choice, never automatic.
 */
import { useState } from 'react';
import { Blocks, RefreshCw } from 'lucide-react';
import { Button, Spinner, useNotify } from '@itrms/ui';
import type { FormField, FormTemplate } from '@itrms/schemas';

import { useBlockLoader, usePublishedBlocks } from '../api/templates';
import { useEngineText } from '../host/text';
import { blockOfField } from './blocks';
import { useDesignerActions } from './store';

/** A block template's published version number (the list's `version`), or 0. */
const publishedNumber = (t: FormTemplate) => Number(t.version) || 0;

/** The published blocks, in the palette: a click copies one into the form. */
export function BlocksPalette({ query }: { query: string }) {
    const { t, language } = useEngineText();
    const notify = useNotify();
    const actions = useDesignerActions();
    const load = useBlockLoader();
    const { data: blocks } = usePublishedBlocks();
    const [busy, setBusy] = useState<string | null>(null);
    const q = query.trim().toLowerCase();
    const shown = (blocks ?? []).filter(
        (b) => !q || [b.name, b.slug, ...Object.values(b.names ?? {})].some((text) => text.toLowerCase().includes(q))
    );
    if (shown.length === 0) return null;
    const nameOf = (b: FormTemplate) => b.names?.[language] ?? b.name;
    const insert = async (b: FormTemplate) => {
        setBusy(b.id ?? null);
        try {
            const block = await load(b);
            if (
                !actions.insertBlock({
                    key: block.key,
                    version: block.version,
                    name: block.names,
                    document: block.document
                })
            )
                notify.error(t('form-engine.designer.blocks.insertFailed'));
        } catch {
            notify.error(t('form-engine.designer.blocks.insertFailed'));
        } finally {
            setBusy(null);
        }
    };
    return (
        <section
            className="flex flex-col gap-0.5"
            aria-label={t('form-engine.designer.blocks.title')}
            data-palette-blocks
        >
            <h3 className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('form-engine.designer.blocks.title')}
            </h3>
            {shown.map((b) => (
                <button
                    key={b.id}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void insert(b)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    data-palette-block={b.slug}
                    aria-label={t('form-engine.designer.blocks.add', { name: nameOf(b) })}
                >
                    {busy === b.id ? <Spinner /> : <Blocks className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{nameOf(b)}</span>
                    <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                        {t('form-engine.designer.blocks.version', { number: publishedNumber(b) })}
                    </span>
                </button>
            ))}
        </section>
    );
}

/** On a block's section: the block and version it holds, and the update to a newer published one. */
export function BlockNotice({ stored }: { stored: FormField }) {
    const { t, language } = useEngineText();
    const notify = useNotify();
    const actions = useDesignerActions();
    const load = useBlockLoader();
    const { data: blocks } = usePublishedBlocks();
    const [busy, setBusy] = useState(false);
    const ref = blockOfField(stored);
    if (!ref) return null;
    const block = (blocks ?? []).find((b) => b.slug === ref.key);
    const newest = block ? publishedNumber(block) : 0;
    const name = block ? (block.names?.[language] ?? block.name) : ref.key;
    const update = async () => {
        if (!block) return;
        setBusy(true);
        try {
            const next = await load(block);
            const done = actions.updateBlock(stored.id, {
                key: next.key,
                version: next.version,
                name: next.names,
                document: next.document
            });
            if (!done) notify.error(t('form-engine.designer.blocks.updateRefused'));
        } catch {
            notify.error(t('form-engine.designer.blocks.updateRefused'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm" data-block-notice={ref.key}>
            <p>{t('form-engine.designer.blocks.holds', { name, number: ref.version })}</p>
            {newest > ref.version ? (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void update()}>
                    {busy ? <Spinner /> : <RefreshCw />}
                    {t('form-engine.designer.blocks.update', { number: newest })}
                </Button>
            ) : (
                <p className="text-muted-foreground">{t('form-engine.designer.blocks.current')}</p>
            )}
        </div>
    );
}
