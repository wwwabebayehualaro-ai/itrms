'use client';

/**
 * The person's drafts (task 0.20c), on the "start a request" page and a form's requests page: those on the server (from
 * any PC) and those kept only in this browser (never reached the server, or whose server draft is gone with a change
 * still unsaved here), the latest first, each resumed or thrown away. A copy here whose server draft is gone and which
 * holds nothing unsaved is cleaned up. A server draft changed here since its last save says so.
 */
import { useEffect, useState } from 'react';
import { FilePen, Trash2 } from 'lucide-react';
import { Button, confirmAction } from '@itrms/ui';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/lib/auth/authStore';
import {
    discardDraft,
    draftKeys,
    useMyDrafts,
    type DraftStart,
    type DraftSummary,
    type LocalDraftMeta
} from '@/lib/drafts';
import { removeLocal } from '@/lib/drafts/store';
import { formatMoment } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';

interface Row {
    key: string;
    formId: string;
    name: string;
    at: string;
    server: DraftSummary | null;
    local: LocalDraftMeta | null;
}

export function DraftsList({
    formId,
    formName,
    onResume
}: {
    /** only one form's drafts (its requests page) */
    formId?: string;
    /** a form's name when only this browser knows the draft */
    formName: (formId: string) => string | undefined;
    onResume: (formId: string, start: DraftStart) => void;
}) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const userId = useAuthStore((s) => s.user?.id);
    const queries = useQueryClient();
    const { server, local } = useMyDrafts(userId);
    const [busy, setBusy] = useState<string | null>(null);

    const here = new Map((local.data ?? []).map((l) => [l.draftId ?? l.localId, l]));
    const onServer = new Set((server.data ?? []).map((d) => d.id));
    // a copy here whose server draft is gone (filed or thrown away elsewhere): shown while it holds an unsaved change
    const gone = (l: LocalDraftMeta) => server.isSuccess && l.draftId !== null && !onServer.has(l.draftId);
    useEffect(() => {
        const stale = (local.data ?? []).filter((l) => gone(l) && l.synced);
        if (stale.length === 0) return;
        void Promise.all(stale.map((l) => removeLocal(l.localId))).then(() =>
            queries.invalidateQueries({ queryKey: draftKeys.all })
        );
    });
    const rows: Row[] = [
        ...(server.data ?? []).map((d) => {
            const l = here.get(d.id) ?? null;
            return {
                key: d.id,
                formId: d.formId,
                name: text(d.formName),
                at: l && l.updatedAt > Date.parse(d.updatedAt) ? new Date(l.updatedAt).toISOString() : d.updatedAt,
                server: d,
                local: l
            };
        }),
        ...(local.data ?? [])
            .filter((l) => !l.draftId || (gone(l) && !l.synced))
            .map((l) => ({
                key: l.localId,
                formId: l.formId,
                name: formName(l.formId) ?? '—',
                at: new Date(l.updatedAt).toISOString(),
                server: null,
                local: l
            }))
    ]
        .filter((row) => !formId || row.formId === formId)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (rows.length === 0) return null;

    const discard = (row: Row) =>
        void confirmAction({
            header: t('forms.draft.discardTitle'),
            message: t('forms.draft.discardBody', { form: row.name }),
            acceptLabel: t('forms.draft.discard'),
            danger: true,
            onAccept: async () => {
                setBusy(row.key);
                try {
                    await discardDraft(row.local, row.server);
                    await queries.invalidateQueries({ queryKey: draftKeys.all });
                } finally {
                    setBusy(null);
                }
            }
        });

    return (
        <section className="flex flex-col gap-2 rounded-md border p-4" data-drafts>
            <h2 className="font-medium">{t('forms.draft.title')}</h2>
            <ul className="flex flex-col divide-y">
                {rows.map((row) => (
                    <li
                        key={row.key}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                        data-draft={row.formId}
                    >
                        <div className="flex flex-col">
                            <span className="font-medium">{row.name}</span>
                            <span className="text-muted-foreground text-xs">
                                {formatMoment(row.at, { language, calendar })}
                                {!row.server && ` · ${t('forms.draft.onlyHere')}`}
                                {row.server && row.local && !row.local.synced && ` · ${t('forms.draft.changedHere')}`}
                                {row.server?.outdated && ` · ${t('forms.draft.outdated')}`}
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                onClick={() =>
                                    onResume(row.formId, {
                                        ...(row.server ? { draft: row.server } : {}),
                                        ...(row.local ? { local: row.local } : {})
                                    })
                                }
                            >
                                <FilePen />
                                {t('forms.draft.resume')}
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy === row.key}
                                aria-label={t('forms.draft.discardOf', { form: row.name })}
                                onClick={() => discard(row)}
                            >
                                <Trash2 />
                            </Button>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}
