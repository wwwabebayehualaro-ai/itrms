'use client';

/**
 * A case (task 0.20b): where it stands, the step that is open and who has it, what the person may do now, its timeline
 * (steps, routings, comments) and the answers filled in on each step. Documents and payments join as they arrive (0.22,
 * 0.23). An action that files a step form is taken where the service's request flow shows the form (0.21).
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, FileText, MessageSquare, Route, Send, Workflow } from 'lucide-react';
import { PrintForm } from '@itrms/form-engine/print';
import { FormRenderer, useLookupLabels } from '@itrms/form-engine/renderer';
import {
    Button,
    DescriptionList,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    EmptyState,
    InlineStatus,
    Label,
    PageHeader,
    Skeleton,
    StatusBadge,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    Textarea,
    type Tone
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useFormVersion } from '@/lib/services';
import { templateFor, withHelp } from '@/form-templates/serviceForm';
import { useAuthStore } from '@/lib/auth/authStore';
import { formatMoment } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { useCase, useClaim, useTransition, type CaseOut, type SlaState } from '@/lib/workflow';
import { CommentBox } from './CommentBox';

const SLA_TONE: Record<SlaState, Tone> = {
    none: 'muted',
    'on-time': 'success',
    'due-soon': 'warning',
    overdue: 'danger'
};

type Action = CaseOut['actionDetails'][number];

export function CasePage({ id }: { id: string }) {
    const { t, text } = useText();
    const kase = useCase(id);

    if (kase.isPending) return <Skeleton className="h-64 w-full" />;
    if (kase.error || !kase.data)
        return (
            <EmptyState
                variant="error"
                title={t('workflow.case.notFound')}
                description={getApiErrorMessage(kase.error)}
            />
        );
    const c = kase.data;
    const stateName = (key: string | null) => (key ? (c.stateLabels[key] ? text(c.stateLabels[key]) : key) : '—');

    return (
        <div className="flex flex-col gap-6" data-screen="case" data-case={c.id} data-state={c.state}>
            <Link href="/inbox" className="flex w-fit items-center gap-2 text-sm text-primary hover:underline">
                <ArrowLeft className="size-4" />
                {t('workflow.nav.inbox')}
            </Link>
            <PageHeader
                title={t('workflow.case.number', { number: String(c.number) })}
                description={text(c.workflow.name)}
                actions={
                    <StatusBadge
                        value={c.closed ? 'closed' : c.state}
                        tone={c.closed ? 'success' : 'progress'}
                        label={stateName(c.state)}
                    />
                }
            />
            <CaseFacts c={c} />
            <OpenStep c={c} stateName={stateName} />
            <Tabs defaultValue="timeline">
                <TabsList>
                    <TabsTrigger value="timeline">
                        <Workflow />
                        {t('workflow.case.timeline')}
                    </TabsTrigger>
                    <TabsTrigger value="answers">
                        <FileText />
                        {t('workflow.case.answers')}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="timeline" className="flex flex-col gap-4 pt-2">
                    <Timeline c={c} stateName={stateName} />
                    {c.canComment && <CommentBox caseId={c.id} />}
                </TabsContent>
                <TabsContent value="answers" className="pt-2">
                    <Steps c={c} stateName={stateName} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function CaseFacts({ c }: { c: CaseOut }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    return (
        <DescriptionList
            items={[
                { term: t('workflow.case.handlingUnit'), value: text(c.handlingUnit.name) },
                { term: t('workflow.case.startedBy'), value: c.startedByName },
                { term: t('workflow.case.startedAt'), value: formatMoment(c.createdAt, { language, calendar }) },
                ...(c.closedAt
                    ? [{ term: t('workflow.case.closedAt'), value: formatMoment(c.closedAt, { language, calendar }) }]
                    : [])
            ]}
        />
    );
}

/** The step that is open now (if the person's office sees it), who has it, and what they may do. */
function OpenStep({ c, stateName }: { c: CaseOut; stateName: (key: string | null) => string }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const me = useAuthStore((s) => s.user?.id);
    const roleLabels = useAuthStore((s) => s.workspace?.roleLabels);
    const activeUnit = useAuthStore((s) => s.workspace?.activeUnit.id);
    const claim = useClaim(c.id);
    const [acting, setActing] = useState<Action | null>(null);
    const task = c.tasks.find((x) => x.status === 'open');
    if (c.closed || (!task && c.actionDetails.length === 0)) return null;
    const mine = task?.claimedBy?.id === me;
    const roleName = (role: string) => (roleLabels?.[role] ? text(roleLabels[role]) : role);

    return (
        <section className="flex flex-col gap-3 rounded-md border p-4" data-open-step={task?.id ?? 'start'}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <h2 className="font-medium">{t('workflow.case.currentStep', { step: stateName(c.state) })}</h2>
                    {task && (
                        <p className="text-muted-foreground text-sm">
                            {t('workflow.case.assigned', { role: roleName(task.role), unit: text(task.unit.name) })}
                            {task.routedFrom &&
                                ` · ${t('workflow.case.routedFrom', { unit: text(task.routedFrom.name) })}`}
                        </p>
                    )}
                    {task?.dueAt && (
                        <div className="flex items-center gap-2 text-sm">
                            <StatusBadge
                                value={task.sla}
                                tone={SLA_TONE[task.sla]}
                                label={t(`workflow.sla.${task.sla}`)}
                            />
                            <span className="text-muted-foreground">
                                {t('workflow.case.dueAt', { at: formatMoment(task.dueAt, { language, calendar }) })}
                            </span>
                        </div>
                    )}
                    {task?.claimedBy && (
                        <p className="text-sm" data-claimed-by={task.claimedBy.id}>
                            {mine
                                ? t('workflow.case.claimedByYou')
                                : t('workflow.case.claimedBy', { name: task.claimedBy.name })}
                        </p>
                    )}
                </div>
                {task && task.unit.id === activeUnit && (
                    <div className="flex gap-2">
                        {!task.claimedBy && c.actions.length > 0 && (
                            <Button
                                variant="outline"
                                disabled={claim.isPending}
                                onClick={() => claim.mutate({ taskId: task.id })}
                            >
                                {t('workflow.action.claim')}
                            </Button>
                        )}
                        {mine && (
                            <Button
                                variant="ghost"
                                disabled={claim.isPending}
                                onClick={() => claim.mutate({ taskId: task.id, release: true })}
                            >
                                {t('workflow.action.release')}
                            </Button>
                        )}
                    </div>
                )}
            </div>
            {claim.error && <p className="text-destructive text-sm">{getApiErrorMessage(claim.error)}</p>}
            {c.actionDetails.length > 0 && (
                <div className="flex flex-wrap gap-2" data-actions>
                    {c.actionDetails.map((a) => (
                        <Button
                            key={a.action}
                            data-action={a.action}
                            variant={a.action === 'reject' ? 'outline' : 'default'}
                            disabled={a.needsForm && !a.form}
                            title={a.needsForm && !a.form ? t('workflow.case.needsForm') : undefined}
                            onClick={() => setActing(a)}
                        >
                            {a.label ? text(a.label) : a.action}
                        </Button>
                    ))}
                </div>
            )}
            {acting && <ActionDialog c={c} action={acting} onClose={() => setActing(null)} />}
        </section>
    );
}

/** Takes an action, with a comment (required where the workflow says so). */
/**
 * A step's form inside its action (task 0.21c): the version the step names, filled in the dialog; its
 * answers go with the transition, which files them on the case (validated on the server).
 */
function StepForm({
    c,
    action,
    name,
    comment,
    onDone
}: {
    c: CaseOut;
    action: Action;
    /** the action's label, on the form's submit */
    name: string;
    comment: string;
    onDone: () => void;
}) {
    const { t } = useText();
    const transition = useTransition(c.id);
    // the request an action changes (task 0.21e) is filled in again as the person sees it: its fields without those of
    // other roles, its answers without the Sensitive ones (left out, they keep theirs)
    const request = action.amends ? c.steps.find((s) => s.submissionId === action.amends) : undefined;
    const version = useFormVersion(request ? null : action.form);
    const document = request ? request.form : version.data?.document;
    const fields = useMemo(() => (document ? withHelp(document, {}) : null), [document]);
    if (version.error) return <p className="text-destructive text-sm">{getApiErrorMessage(version.error)}</p>;
    if (!fields || !action.form) return <InlineStatus loading className="p-4" />;
    return (
        <div data-step-form={action.form?.formId} data-amends={action.amends ?? undefined}>
            <p className="text-sm text-muted-foreground">
                {request ? t('workflow.case.changeRequest') : t('workflow.case.fillStep')}
            </p>
            <FormRenderer
                bare
                silent
                fields={fields}
                template={templateFor(action.form, fields)}
                {...(request ? { submissionId: request.submissionId, initialValues: request.answers } : {})}
                submitLabel={name}
                onFormSubmit={async (submission) => {
                    const after = await transition.mutateAsync({
                        version: c.version,
                        action: action.action,
                        answers: request
                            ? keptMasked(submission.submission_data, request.masked)
                            : submission.submission_data,
                        ...(comment.trim() ? { comment: comment.trim() } : {})
                    });
                    onDone();
                    return after;
                }}
            />
        </div>
    );
}

/** A changed request's answers without the Sensitive ones left blank: shown masked, those keep their stored answer. */
function keptMasked(answers: Record<string, unknown>, masked: readonly string[]): Record<string, unknown> {
    const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    return Object.fromEntries(Object.entries(answers).filter(([k, v]) => !(masked.includes(k) && blank(v))));
}

function ActionDialog({ c, action, onClose }: { c: CaseOut; action: Action; onClose: () => void }) {
    const { t, text } = useText();
    const transition = useTransition(c.id);
    const [comment, setComment] = useState('');
    const missing = action.commentRequired && comment.trim() === '';
    const name = action.label ? text(action.label) : action.action;
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-action-dialog={action.action} className={action.form ? 'max-w-3xl' : undefined}>
                <DialogHeader>
                    <DialogTitle>{name}</DialogTitle>
                    <DialogDescription>
                        {t('workflow.case.confirmAction', { number: String(c.number) })}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="action-comment">
                        {action.commentRequired
                            ? t('workflow.case.commentRequired')
                            : t('workflow.case.commentOptional')}
                    </Label>
                    <Textarea
                        id="action-comment"
                        value={comment}
                        maxLength={2000}
                        onChange={(e) => setComment(e.target.value)}
                    />
                </div>
                {action.form && !missing && (
                    <StepForm c={c} action={action} name={name} comment={comment} onDone={onClose} />
                )}
                {transition.error && (
                    <p className="text-destructive text-sm" role="alert">
                        {getApiErrorMessage(transition.error)}
                    </p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('workflow.case.cancel')}
                    </Button>
                    {!action.form && (
                        <Button
                            disabled={missing || transition.isPending}
                            onClick={() =>
                                transition.mutate(
                                    {
                                        version: c.version,
                                        action: action.action,
                                        ...(comment.trim() ? { comment: comment.trim() } : {})
                                    },
                                    { onSuccess: onClose }
                                )
                            }
                        >
                            <Send />
                            {name}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Timeline({ c, stateName }: { c: CaseOut; stateName: (key: string | null) => string }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const who = (e: CaseOut['events'][number]) =>
        e.actorName ?? (e.systemActor ? t('workflow.case.system') : t('workflow.case.someone'));
    // a changed request names its fields by their labels in the reader's language (the request's form, as they see it)
    const labels = useMemo(() => {
        const out = new Map<string, string>();
        for (const s of c.steps) {
            const fields = (s.form as { fields?: { id?: unknown; label?: unknown }[] } | null)?.fields ?? [];
            for (const f of fields) {
                const label = f.label;
                const shown =
                    typeof label === 'string'
                        ? label
                        : label && typeof label === 'object'
                          ? text(label as Record<string, string>)
                          : '';
                if (typeof f.id === 'string' && shown) out.set(f.id, shown);
            }
        }
        return out;
    }, [c.steps, text]);
    const labelOf = (key: string) => labels.get(key) ?? key;
    return (
        <ol className="flex flex-col gap-3" data-timeline>
            {c.events.map((e) => (
                <li key={e.id} className="flex gap-3 rounded-md border p-3" data-event={e.kind}>
                    <span className="mt-0.5 text-muted-foreground">
                        {e.kind === 'comment' ? <MessageSquare className="size-4" /> : <Route className="size-4" />}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium">
                                {e.kind === 'started'
                                    ? t('workflow.event.started', { who: who(e) })
                                    : e.kind === 'routed'
                                      ? t('workflow.event.routed', { step: stateName(e.to) })
                                      : e.kind === 'comment'
                                        ? t('workflow.event.comment', { who: who(e) })
                                        : t('workflow.event.transition', {
                                              who: who(e),
                                              from: stateName(e.from),
                                              to: stateName(e.to)
                                          })}
                            </span>
                            <time dateTime={e.at} className="text-muted-foreground text-xs">
                                {formatMoment(e.at, { language, calendar })}
                            </time>
                        </div>
                        {e.amended && e.amended.length > 0 && (
                            <p className="text-sm" data-amended={e.amended.join(' ')}>
                                {t('workflow.event.amended', { fields: e.amended.map(labelOf).join(', ') })}
                            </p>
                        )}
                        {e.comment && <p className="whitespace-pre-wrap text-sm">{e.comment}</p>}
                        {e.mentions.length > 0 && (
                            <p className="text-muted-foreground text-xs" data-mentions>
                                {t('workflow.event.mentions', { names: e.mentions.map((m) => m.name).join(', ') })}
                            </p>
                        )}
                    </div>
                </li>
            ))}
        </ol>
    );
}

/** The answers filled in on each step, printed as the form was (the reader's restricted fields left out). */
function Steps({ c, stateName }: { c: CaseOut; stateName: (key: string | null) => string }) {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const roles = useAuthStore((s) => s.workspace?.roles);
    // a lookup answer prints its record's label, not its id: one request per registry for all the steps
    const labels = useLookupLabels(useMemo(() => lookupIds(c.steps), [c.steps]));
    const refs = useMemo(() => new Map([...labels.values()].flatMap((m) => [...m])), [labels]);
    if (c.steps.length === 0)
        return <EmptyState title={t('workflow.case.noAnswers')} description={t('workflow.case.noAnswersHint')} />;
    return (
        <div className="flex flex-col gap-4">
            {c.steps.map((s) => (
                <section key={s.submissionId} className="flex flex-col gap-2 rounded-md border p-4" data-step={s.state}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-medium">{stateName(s.state)}</h3>
                        <span className="text-muted-foreground text-xs">
                            {s.submittedBy?.name ?? '—'} · {formatMoment(s.at, { language, calendar })}
                        </span>
                    </div>
                    {s.masked.length > 0 && (
                        <p className="text-muted-foreground text-xs" data-step-masked>
                            {t('workflow.case.maskedAnswers')}{' '}
                            <Link
                                href={`/submitted-forms/template/${s.formId}/${s.submissionId}`}
                                className="text-primary hover:underline"
                            >
                                {t('workflow.case.openRecord')}
                            </Link>
                        </p>
                    )}
                    <PrintForm form={s.form} values={s.answers} language={language} options={{ roles, refs }} />
                </section>
            ))}
        </div>
    );
}

/** The registry records the steps' lookup answers name, by registry (a repeating section's rows too). */
function lookupIds(steps: CaseOut['steps']): Map<string, string[]> {
    const wanted = new Map<string, string[]>();
    for (const s of steps) {
        const fields =
            (s.form as { fields?: { id?: unknown; type?: unknown; props?: unknown }[] } | null)?.fields ?? [];
        const providers = new Map<string, string>();
        for (const f of fields) {
            const provider = (f.props as { provider?: unknown } | null | undefined)?.provider;
            if (f.type === 'RegistryLookup' && typeof f.id === 'string' && typeof provider === 'string')
                providers.set(f.id, provider);
        }
        if (providers.size === 0) continue;
        const collect = (values: Record<string, unknown>) => {
            for (const [key, v] of Object.entries(values)) {
                const provider = providers.get(key);
                if (provider && typeof v === 'string' && v !== '')
                    wanted.set(provider, [...(wanted.get(provider) ?? []), v]);
                else if (Array.isArray(v))
                    for (const row of v)
                        if (row && typeof row === 'object' && !Array.isArray(row))
                            collect(row as Record<string, unknown>);
            }
        };
        collect(s.answers);
    }
    return wanted;
}
