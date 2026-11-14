'use client';

/**
 * A form's analytics in the builder (task 1.13f, form-platform.md §6): counts only, from the fills the author's office and those
 * below it made. How many fills were opened and submitted, how long a submitted one took, which fields stopped people most (named
 * by their labels in the builder's language), and where the fills left unfinished stopped. They show where a form confuses.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Spinner } from '@itrms/ui';
import { formTextIn } from '@itrms/schemas';

import { FORMS_API } from '../api/wire';
import { useFormsClient } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import { useDesigner } from './store';

/** What the API gives (platform/forms formAnalyticsSchema). */
export interface FormAnalytics {
    fills: { opened: number; submitted: number; stopped: number };
    medianSeconds: number | null;
    fieldErrors: { key: string; count: number }[];
    abandoned: { step: string | null; count: number }[];
}

export function useFormAnalytics(formId: string | undefined, enabled: boolean) {
    const client = useFormsClient();
    return useQuery({
        queryKey: ['templates', 'detail', formId ?? '', 'analytics'] as const,
        queryFn: async ({ signal }) =>
            (await client.get<FormAnalytics>(`${FORMS_API.forms}/${formId}/analytics`, { signal })).data,
        enabled: enabled && !!formId
    });
}

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

export function AnalyticsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const { t } = useEngineText();
    const templateId = useDesigner((s) => s.template.id);
    const doc = useDesigner((s) => s.doc);
    const language = useDesigner((s) => s.language);
    const { data, isPending, isError } = useFormAnalytics(templateId, open);
    // a key named by its label in the builder's language; a key the form no longer has, by itself
    const labelOf = useMemo(
        () => (key: string) => {
            const f = doc.byId[key];
            return (f && formTextIn(f.label, language)) || key;
        },
        [doc.byId, language]
    );
    const most = data?.fieldErrors[0]?.count ?? 0;
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-form-analytics>
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <BarChart3 className="size-4" aria-hidden="true" />
                        {t('form-engine.designer.analytics.title')}
                    </SheetTitle>
                    <SheetDescription>{t('form-engine.designer.analytics.description')}</SheetDescription>
                </SheetHeader>
                <div className="grid gap-5 px-4 pb-6">
                    {isPending && <Spinner />}
                    {isError && <p className="text-sm">{t('form-engine.designer.analytics.failed')}</p>}
                    {data && (
                        <>
                            <dl className="grid grid-cols-3 gap-3 text-center" data-analytics-fills>
                                {(
                                    [
                                        ['opened', data.fills.opened],
                                        ['submitted', data.fills.submitted],
                                        ['stopped', data.fills.stopped]
                                    ] as const
                                ).map(([k, n]) => (
                                    <div key={k} className="rounded-md border p-2">
                                        <dt className="text-xs text-muted-foreground">
                                            {t(`form-engine.designer.analytics.${k}`)}
                                        </dt>
                                        <dd className="text-lg font-semibold tabular-nums" data-analytics-count={k}>
                                            {n}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                            <p className="text-sm" data-analytics-time>
                                {data.medianSeconds === null
                                    ? t('form-engine.designer.analytics.noTime')
                                    : t('form-engine.designer.analytics.time', {
                                          minutes: minutes(data.medianSeconds)
                                      })}
                            </p>
                            <section className="grid gap-2">
                                <h3 className="text-sm font-semibold">{t('form-engine.designer.analytics.fields')}</h3>
                                {data.fieldErrors.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        {t('form-engine.designer.analytics.noErrors')}
                                    </p>
                                ) : (
                                    <ol className="grid gap-1.5">
                                        {data.fieldErrors.map((f) => (
                                            <li key={f.key} className="grid gap-1 text-sm" data-analytics-field={f.key}>
                                                <span className="flex justify-between gap-2">
                                                    <span>{labelOf(f.key)}</span>
                                                    <span className="tabular-nums text-muted-foreground">
                                                        {f.count}
                                                    </span>
                                                </span>
                                                <span
                                                    className="h-1.5 rounded-full bg-primary"
                                                    style={{ width: `${Math.max(4, (f.count / most) * 100)}%` }}
                                                    aria-hidden="true"
                                                />
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </section>
                            <section className="grid gap-2">
                                <h3 className="text-sm font-semibold">
                                    {t('form-engine.designer.analytics.abandoned')}
                                </h3>
                                {data.abandoned.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        {t('form-engine.designer.analytics.noAbandoned')}
                                    </p>
                                ) : (
                                    <ul className="grid gap-1 text-sm">
                                        {data.abandoned.map((a) => (
                                            <li
                                                key={a.step ?? '-'}
                                                className="flex justify-between"
                                                data-analytics-abandoned={a.step ?? ''}
                                            >
                                                <span>
                                                    {a.step
                                                        ? labelOf(a.step)
                                                        : t('form-engine.designer.analytics.noStep')}
                                                </span>
                                                <span className="tabular-nums text-muted-foreground">{a.count}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
