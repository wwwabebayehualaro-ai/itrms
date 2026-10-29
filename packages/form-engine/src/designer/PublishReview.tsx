'use client';

/**
 * What a publication would do, for the person who asks for it and the one who approves it: the problems that block it and the
 * ones that only warn, the form's test cases, what changed against the published version and the views that name changed
 * keys. Display only: the check itself (GET publish-check / review) is the server's.
 */
import type { ReactNode } from 'react';
import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Spinner,
    useNotify
} from '@itrms/ui';

import type { DiffChange, FormDiff } from '../core';
import type { I18nText } from '@itrms/schemas';
import { useEngineText } from '../host/text';
import type { EngineMessageKey } from '../core/messages';
import { usePublishCheck, useTemplateMutations } from '../api/templates';
import type { PublishCheck, PublishCheckProblem } from '../api/wire';

const AREA_WORD = {
    label: 'form-engine.designer.publish.area.label',
    texts: 'form-engine.designer.publish.area.texts',
    type: 'form-engine.designer.publish.area.type',
    kind: 'form-engine.designer.publish.area.kind',
    parent: 'form-engine.designer.publish.area.parent',
    order: 'form-engine.designer.publish.area.order',
    options: 'form-engine.designer.publish.area.options',
    required: 'form-engine.designer.publish.area.required',
    rules: 'form-engine.designer.publish.area.rules',
    visibility: 'form-engine.designer.publish.area.visibility',
    enabled: 'form-engine.designer.publish.area.enabled',
    computed: 'form-engine.designer.publish.area.computed',
    roles: 'form-engine.designer.publish.area.roles',
    filterable: 'form-engine.designer.publish.area.filterable',
    classification: 'form-engine.designer.publish.area.classification',
    settings: 'form-engine.designer.publish.area.settings'
} as const satisfies Record<DiffChange['area'], EngineMessageKey>;

const FORM_AREA_WORD = {
    dataSources: 'form-engine.designer.publish.formArea.dataSources',
    testCases: 'form-engine.designer.publish.formArea.testCases',
    textLanguage: 'form-engine.designer.publish.formArea.textLanguage'
} as const satisfies Record<FormDiff['form'][number]['area'], EngineMessageKey>;

function Section({
    title,
    count,
    children,
    name
}: {
    title: string;
    count?: number;
    children: ReactNode;
    name: string;
}) {
    return (
        <section className="grid gap-2" data-review-section={name}>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
                {title}
                {count !== undefined && <Badge variant="outline">{count}</Badge>}
            </h3>
            {children}
        </section>
    );
}

function Problems({ problems }: { problems: PublishCheckProblem[] }) {
    return (
        <ul className="grid gap-1 text-sm">
            {problems.map((p, i) => (
                <li key={`${p.code}:${p.path}:${i}`} className="flex gap-2" data-problem={p.code}>
                    {p.fieldId && <code className="shrink-0 text-xs text-muted-foreground">{p.fieldId}</code>}
                    <span>{p.message}</span>
                </li>
            ))}
        </ul>
    );
}

const shown = (v: unknown): string => (typeof v === 'string' ? v : (JSON.stringify(v) ?? ''));

/** The difference between two versions of a form, by field. Used by the review and by the version history. */
export function DiffView({ diff }: { diff: FormDiff }) {
    const { t } = useEngineText();
    const empty =
        !diff.added.length &&
        !diff.removed.length &&
        !diff.restored.length &&
        !diff.changed.length &&
        !diff.form.length;
    if (empty) return <p className="text-sm text-muted-foreground">{t('form-engine.designer.publish.noChanges')}</p>;
    const list = (name: string, label: string, fields: { key: string; label: string }[]) =>
        fields.length > 0 && (
            <li data-diff={name}>
                <span className="font-medium">{label}</span>
                <ul className="ms-4 list-disc">
                    {fields.map((f) => (
                        <li key={f.key}>
                            {f.label || f.key} <code className="text-xs text-muted-foreground">{f.key}</code>
                        </li>
                    ))}
                </ul>
            </li>
        );
    return (
        <ul className="grid gap-2 text-sm" data-diff-view>
            {list('added', t('form-engine.designer.publish.added'), diff.added)}
            {list('removed', t('form-engine.designer.publish.removed'), diff.removed)}
            {list('restored', t('form-engine.designer.publish.restored'), diff.restored)}
            {diff.changed.length > 0 && (
                <li data-diff="changed">
                    <span className="font-medium">{t('form-engine.designer.publish.changed')}</span>
                    <ul className="ms-4 list-disc">
                        {diff.changed.map((c) => (
                            <li key={c.key} data-diff-field={c.key}>
                                {c.label || c.key} <code className="text-xs text-muted-foreground">{c.key}</code>
                                <span className="ms-2 text-muted-foreground">
                                    {[...new Set(c.changes.map((x) => t(AREA_WORD[x.area])))].join(', ')}
                                </span>
                                {c.changes
                                    .filter((x) => x.area === 'label' || x.area === 'required')
                                    .map((x, i) => (
                                        <div key={i} className="ms-2 text-xs text-muted-foreground">
                                            {shown(x.before)} → {shown(x.after)}
                                        </div>
                                    ))}
                            </li>
                        ))}
                    </ul>
                </li>
            )}
            {diff.form.length > 0 && (
                <li data-diff="form">
                    <span className="font-medium">{t('form-engine.designer.publish.formChanged')}</span>
                    <ul className="ms-4 list-disc">
                        {diff.form.map((x) => (
                            <li key={x.area}>{t(FORM_AREA_WORD[x.area])}</li>
                        ))}
                    </ul>
                </li>
            )}
        </ul>
    );
}

export function PublishReview({ check }: { check: PublishCheck }) {
    const { t, word } = useEngineText();
    const errors = check.problems.filter((p) => p.severity === 'error');
    const warnings = check.problems.filter((p) => p.severity === 'warning');
    return (
        <div className="grid gap-4" data-publish-review data-can-publish={check.canPublish}>
            <p className="text-sm text-muted-foreground">
                {check.base
                    ? t('form-engine.designer.publish.against', { number: check.base.number })
                    : t('form-engine.designer.publish.first')}
            </p>
            <p
                className={check.canPublish ? 'text-sm font-medium' : 'text-sm font-medium text-destructive'}
                role={check.canPublish ? undefined : 'alert'}
            >
                {check.canPublish
                    ? t('form-engine.designer.publish.canPublish')
                    : t('form-engine.designer.publish.cannotPublish')}
            </p>
            {errors.length > 0 && (
                <Section name="errors" title={t('form-engine.designer.publish.blocking')} count={errors.length}>
                    <Problems problems={errors} />
                </Section>
            )}
            {check.tests.length > 0 && (
                <Section name="tests" title={t('form-engine.designer.publish.tests')} count={check.tests.length}>
                    <ul className="grid gap-1 text-sm">
                        {check.tests.map((x) => (
                            <li key={x.id} data-test-case={x.id} data-passed={x.passed}>
                                <span className="flex items-center gap-2">
                                    <Badge variant={x.passed ? 'outline' : 'destructive'}>
                                        {x.passed
                                            ? t('form-engine.designer.tests.passed')
                                            : t('form-engine.designer.tests.failed')}
                                    </Badge>
                                    {x.name}
                                </span>
                                {x.mismatches.map((m) => (
                                    <div key={m.path} className="ms-4 text-xs text-muted-foreground">
                                        <code>{m.path}</code>: {shown(m.expected)} → {shown(m.actual)}
                                    </div>
                                ))}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
            {warnings.length > 0 && (
                <Section name="warnings" title={t('form-engine.designer.publish.warnings')} count={warnings.length}>
                    <Problems problems={warnings} />
                </Section>
            )}
            <Section name="changes" title={t('form-engine.designer.publish.changes')}>
                <DiffView diff={check.diff} />
            </Section>
            {(check.impact.services ?? []).length > 0 && (
                <Section
                    name="services"
                    title={t('form-engine.designer.publish.services')}
                    count={check.impact.services?.length ?? 0}
                >
                    <ul className="grid gap-1 text-sm">
                        {(check.impact.services ?? []).map((s) => (
                            <li key={s.code} data-impact-service={s.code}>
                                <span className="font-mono text-xs">{s.code}</span>{' '}
                                <span className="font-medium">{word(s.name as I18nText)}</span>
                                <span className="ms-2 text-xs text-muted-foreground">
                                    {t('form-engine.designer.publish.serviceCases', { count: s.openCases })} ·{' '}
                                    {s.effects.join(', ')}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
            <Section name="views" title={t('form-engine.designer.publish.views')} count={check.impact.views.length}>
                {check.impact.views.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('form-engine.designer.publish.noViews')}</p>
                ) : (
                    <ul className="grid gap-1 text-sm">
                        {check.impact.views.map((v) => (
                            <li key={v.id} data-view={v.id}>
                                <span className="font-medium">{v.name}</span>{' '}
                                <Badge variant="outline">
                                    {v.visibility === 'unit'
                                        ? t('form-engine.designer.publish.viewShared')
                                        : t('form-engine.designer.publish.viewPrivate')}
                                </Badge>
                                <span className="ms-2 text-xs text-muted-foreground">
                                    {v.keys.map((k) => k.key).join(', ')}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
}

/**
 * Asks for a publication of a saved form: shows what it would do (the server's check of the working copy) and sends the
 * request when nothing blocks it. A second person approves it in the approvals inbox.
 */
export function PublishDialog({
    templateId,
    name,
    open,
    onOpenChange
}: {
    templateId: string;
    name: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useEngineText();
    const notify = useNotify();
    const check = usePublishCheck(templateId, open);
    const { publish } = useTemplateMutations();
    const send = () =>
        publish.mutate(
            { id: templateId },
            {
                onSuccess: (p) => {
                    onOpenChange(false);
                    notify.success(
                        p.status === 'published'
                            ? t('form-engine.designer.publish.published')
                            : t('form-engine.designer.publish.sentForApproval')
                    );
                }
            }
        );
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-publish-dialog>
                <DialogHeader>
                    <DialogTitle>{t('form-engine.designer.publish.title', { name })}</DialogTitle>
                    <DialogDescription>{t('form-engine.designer.publish.description')}</DialogDescription>
                </DialogHeader>
                {check.isPending && <Spinner />}
                {check.isError && (
                    <p className="text-sm text-destructive" role="alert">
                        {t('form-engine.designer.publish.checkFailed')}
                    </p>
                )}
                {check.data && <PublishReview check={check.data} />}
                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                        {t('form-engine.designer.publish.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={!check.data?.canPublish || publish.isPending}
                        onClick={send}
                        data-request-publication
                    >
                        {publish.isPending && <Spinner />}
                        {t('form-engine.designer.publish.request')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
