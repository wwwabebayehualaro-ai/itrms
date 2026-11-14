'use client';

/**
 * Wizard steps (task 1.13c): the steps of a form filled one at a time. The values stay the form's own across the steps; "Next"
 * checks the fields of the step shown (they are marked touched, so their messages show) and goes on only when they are valid. A
 * submit that the whole form's check stops goes to the first step with an error. Steps hidden by their rules are skipped.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert } from 'lucide-react';
import { useSelector, type AnyFormApi } from '@tanstack/react-form';
import { Button, cn } from '@itrms/ui';
import {
    containerTitle,
    errorsOfStep,
    firstStepWithErrors,
    isVisibleIn,
    validateForm,
    wizardSteps,
    type EngineDocument,
    type EngineField,
    type FieldErrors
} from '../core';
import { useEngineText } from '../host/text';
import type { RuntimeStore } from './runtimeScope';
import type { WizardPlace } from './FieldTree';

type Values = Record<string, unknown>;

export interface Wizard {
    /** null when the form has no steps, or is only read: every field is drawn */
    place: WizardPlace | null;
    steps: EngineField[];
    index: number;
    blocked: boolean;
    next: () => Promise<void>;
    back: () => void;
    goTo: (id: string) => void;
    /** after a submit the check stopped: the first step with an error */
    showErrors: (errors: FieldErrors) => void;
}

export function useWizard(
    doc: EngineDocument,
    form: AnyFormApi,
    store: RuntimeStore,
    byId: Map<string, EngineField>,
    options: { enabled: boolean; language: string; top: React.RefObject<HTMLElement | null> }
): Wizard {
    const all = useMemo(() => wizardSteps(doc.fields), [doc.fields]);
    const on = options.enabled && all.length > 0;
    // the steps their rules show now, as one string so the form re-renders only when that changes
    const shownKey = useSelector(form.store, (s: { values: Values }) =>
        on
            ? all
                  .filter((step) => isVisibleIn(step, byId, s.values, { ...store.get().scope, root: s.values }, null))
                  .map((step) => step.id)
                  .join('\u0000')
            : ''
    );
    const steps = useMemo(() => {
        const ids = new Set(shownKey ? shownKey.split('\u0000') : []);
        return all.filter((step) => ids.has(step.id));
    }, [all, shownKey]);
    const [chosen, setChosen] = useState<string | undefined>(undefined);
    const [blocked, setBlocked] = useState(false);
    const index = Math.max(
        0,
        steps.findIndex((s) => s.id === chosen)
    );
    const current = steps[index];
    const last = index >= steps.length - 1;
    const steps$ = useRef(steps);
    useEffect(() => {
        steps$.current = steps;
    }, [steps]);

    const toTop = useCallback(() => {
        options.top.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }, [options.top]);

    const focusFirstError = () =>
        requestAnimationFrame(() => {
            const first = options.top.current?.querySelector<HTMLElement>('[data-field-id] [aria-invalid="true"]');
            first?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            first?.focus({ preventScroll: true });
        });

    const next = async () => {
        if (!current) return;
        const errors = validateForm(doc.fields, form.state.values as Values, store.get().scope, {
            language: options.language
        });
        const mine = Object.keys(errorsOfStep(errors, current.id, byId));
        if (mine.length) {
            // the step's fields that are wrong are marked touched: their messages show, the later steps' do not
            for (const key of mine) form.setFieldMeta(key, (m) => (m ? { ...m, isTouched: true } : m));
            await form.validate('change');
            setBlocked(true);
            focusFirstError();
            return;
        }
        setBlocked(false);
        const following = steps[index + 1];
        if (following) {
            setChosen(following.id);
            toTop();
        }
    };

    const back = () => {
        setBlocked(false);
        const previous = steps[index - 1];
        if (previous) {
            setChosen(previous.id);
            toTop();
        }
    };

    const goTo = (id: string) => {
        setBlocked(false);
        setChosen(id);
        toTop();
    };

    const showErrors = (errors: FieldErrors) => {
        const target = firstStepWithErrors(errors, steps$.current, byId);
        if (!target) return;
        setChosen(target);
        setBlocked(true);
        focusFirstError();
    };

    return {
        place: on ? { stepId: current?.id, last } : null,
        steps,
        index,
        blocked,
        next,
        back,
        goTo,
        showErrors
    };
}

/** Where the person is: the steps in order, the one shown marked; an earlier step can be gone back to. */
export function WizardSteps({ wizard }: { wizard: Wizard }) {
    const { t } = useEngineText();
    return (
        <nav aria-label={t('form-engine.renderer.wizard.steps')} data-wizard-steps>
            <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
                {t('form-engine.renderer.wizard.position', {
                    current: wizard.index + 1,
                    total: wizard.steps.length
                })}
            </p>
            <ol className="flex flex-wrap gap-2">
                {wizard.steps.map((step, i) => {
                    const here = i === wizard.index;
                    const done = i < wizard.index;
                    const title = containerTitle(step);
                    return (
                        <li key={step.id} data-wizard-indicator={step.id} aria-current={here ? 'step' : undefined}>
                            {done ? (
                                <Button type="button" variant="ghost" size="sm" onClick={() => wizard.goTo(step.id)}>
                                    <span className="tabular-nums">{i + 1}.</span> {title}
                                </Button>
                            ) : (
                                <span
                                    className={cn(
                                        'inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm',
                                        here ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                                    )}
                                >
                                    <span className="tabular-nums">{i + 1}.</span> {title}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

/** Back and Next under a step that is not the last (the last one has the form's own buttons). */
export function WizardNav({ wizard, children }: { wizard: Wizard; children?: React.ReactNode }) {
    const { t } = useEngineText();
    const last = wizard.index >= wizard.steps.length - 1;
    return (
        <div className="flex flex-col gap-3" data-wizard-nav>
            {wizard.blocked && (
                <div
                    role="alert"
                    className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
                >
                    <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
                    {t('form-engine.renderer.wizard.fixStep')}
                </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    {wizard.index > 0 && (
                        <Button type="button" variant="outline" onClick={wizard.back}>
                            <ArrowLeft />
                            {t('form-engine.renderer.wizard.back')}
                        </Button>
                    )}
                </div>
                {last ? (
                    children
                ) : (
                    <Button type="button" onClick={() => void wizard.next()}>
                        {t('form-engine.renderer.wizard.next')}
                        <ArrowRight />
                    </Button>
                )}
            </div>
        </div>
    );
}
