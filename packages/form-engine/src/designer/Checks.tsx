'use client';

/**
 * The builder's checks: what the publish check would find in the form as it is now (the same lint and key-stability rules the
 * server runs), listed so the author fixes them before asking for a publication. Clicking a problem selects its field.
 */
import { useDeferredValue, useMemo } from 'react';
import { Badge, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@itrms/ui';

import { checkKeyStability, lintDocument, type LintProblem } from '../core';
import { usePublishedTemplate } from '../api/templates';
import { useFormsHost } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import { toStored } from './document';
import { useDesigner, useDesignerActions } from './store';

/** The problems of the form as it is (deferred: typing is never slowed by the checks) and the published form they compare with. */
export function useChecks(): { problems: LintProblem[]; errors: number; warnings: number } {
    const doc = useDeferredValue(useDesigner((s) => s.doc));
    const templateId = useDesigner((s) => s.template.id);
    const { roleKeys, dataSourceAllowList } = useFormsHost();
    const published = usePublishedTemplate(templateId).data;
    return useMemo(() => {
        const stored = toStored(doc);
        const problems = [
            ...lintDocument(stored, {
                ...(dataSourceAllowList ? { dataSources: dataSourceAllowList } : {}),
                ...(roleKeys?.length ? { roleKeys } : {})
            }),
            ...(published ? checkKeyStability(published.form_config, stored) : [])
        ];
        return {
            problems,
            errors: problems.filter((p) => p.severity === 'error').length,
            warnings: problems.filter((p) => p.severity === 'warning').length
        };
    }, [doc, published, roleKeys, dataSourceAllowList]);
}

export function ChecksSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const { t } = useEngineText();
    const actions = useDesignerActions();
    const { problems } = useChecks();
    const byId = useDesigner((s) => s.doc.byId);
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>{t('form-engine.designer.checks.title')}</SheetTitle>
                    <SheetDescription>{t('form-engine.designer.checks.description')}</SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4" data-checks>
                    {problems.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t('form-engine.designer.checks.none')}</p>
                    ) : (
                        <ul className="grid gap-2">
                            {problems.map((p, i) => {
                                const target = p.fieldId && byId[p.fieldId] ? p.fieldId : null;
                                return (
                                    <li key={`${p.rule}:${p.path}:${i}`} data-problem={p.rule}>
                                        <button
                                            type="button"
                                            disabled={!target}
                                            onClick={() => {
                                                if (!target) return;
                                                actions.select(target);
                                                onOpenChange(false);
                                            }}
                                            className="flex w-full items-start gap-2 rounded-md border p-2 text-start text-sm enabled:hover:bg-accent"
                                        >
                                            <Badge variant={p.severity === 'error' ? 'destructive' : 'outline'}>
                                                {p.severity === 'error'
                                                    ? t('form-engine.designer.checks.error')
                                                    : t('form-engine.designer.checks.warning')}
                                            </Badge>
                                            <span className="grid gap-0.5">
                                                <span>{t(p.message, p.values)}</span>
                                                {p.fieldId && (
                                                    <code className="text-xs text-muted-foreground">{p.fieldId}</code>
                                                )}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
