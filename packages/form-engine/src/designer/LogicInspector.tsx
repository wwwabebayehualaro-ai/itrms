'use client';

/**
 * The logic inspector (task 1.13c, form-platform.md §6), under the builder's preview: pick a field and see why it is shown or
 * hidden, can be changed or not, and is required or not, with the values entered in the preview. Each rule on the way (the field's
 * own, then each container's around it) is shown with every condition: the value it looked at, what it compared with, and whether
 * it held. It explains with the engine's own functions, so it says what the form does.
 */
import { useMemo, useState } from 'react';
import { CircleCheck, CircleX, Search } from 'lucide-react';
import { Badge, Card, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@itrms/ui';
import {
    explainField,
    readDocument,
    rowScopedIds,
    type ConditionTrace,
    type EngineField,
    type FieldExplanation,
    type RuleStep
} from '../core';
import type { EngineMessageKey } from '../core/messages';
import { useEngineText } from '../host/text';
import { NO_VALUE, OPS } from './controls';
import type { StoredDocument } from './document';

const OPERATOR = new Map(OPS.map((o) => [o.value, o.label]));

/** A value as the inspector shows it: text as typed, an empty one named, a list or an object as JSON. */
function shown(value: unknown, empty: string): string {
    if (value === undefined || value === null || value === '') return empty;
    if (typeof value === 'string') return `“${value}”`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return '…';
    }
}

/** The fields whose rules decide anything: their own or a container's (a repeating section's row fields are explained per row, not here). */
function ruled(fields: readonly EngineField[]): EngineField[] {
    const inRows = rowScopedIds([...fields]);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const hasRule = (f: EngineField) =>
        f.visibleWhen.length > 0 || f.enabledWhen.length > 0 || Boolean(f.rules.requiredWhen) || f.removed;
    return fields.filter((f) => {
        if (inRows.has(f.id)) return false;
        for (let at: EngineField | undefined = f, depth = 0; at && depth <= fields.length; depth++) {
            if (hasRule(at)) return true;
            at = at.parentId ? byId.get(at.parentId) : undefined;
        }
        return false;
    });
}

export function LogicInspector({
    stored,
    values,
    language
}: {
    stored: StoredDocument;
    values: Record<string, unknown>;
    language: string;
}) {
    const { t } = useEngineText();
    const doc = useMemo(() => readDocument(stored, { language }), [stored, language]);
    const byId = useMemo(() => new Map(doc.fields.map((f) => [f.id, f])), [doc.fields]);
    const candidates = useMemo(() => ruled(doc.fields), [doc.fields]);
    const [picked, setPicked] = useState<string | undefined>(undefined);
    const field = byId.get(picked ?? '') ?? candidates[0];
    const explanation = useMemo(
        () => (field ? explainField(field, byId, values, { root: values }) : undefined),
        [field, byId, values]
    );
    const labelOf = (id: string) => byId.get(id)?.label || id;

    return (
        <Card className="gap-3 p-4" data-logic-inspector>
            <div className="flex items-center gap-2">
                <Search className="size-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-semibold">{t('form-engine.designer.inspector.title')}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{t('form-engine.designer.inspector.intro')}</p>
            {candidates.length === 0 || !field || !explanation ? (
                <p className="text-sm" data-inspector-empty>
                    {t('form-engine.designer.inspector.none')}
                </p>
            ) : (
                <>
                    <Select value={field.id} onValueChange={setPicked}>
                        <SelectTrigger
                            size="sm"
                            className="w-full max-w-sm"
                            aria-label={t('form-engine.designer.inspector.pick')}
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {candidates.map((f) => (
                                <SelectItem key={f.id} value={f.id}>
                                    {f.label || f.id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Explanation explanation={explanation} labelOf={labelOf} />
                </>
            )}
        </Card>
    );
}

function Explanation({ explanation, labelOf }: { explanation: FieldExplanation; labelOf: (id: string) => string }) {
    const { t } = useEngineText();
    const state = (on: boolean, yes: EngineMessageKey, no: EngineMessageKey, key: string) => (
        <Badge variant={on ? 'secondary' : 'outline'} data-inspector-state={key} data-value={on ? 'yes' : 'no'}>
            {t(on ? yes : no)}
        </Badge>
    );
    const required = explanation.requiredBy;
    return (
        <div className="grid gap-3" data-inspector-field={explanation.fieldId}>
            <div className="flex flex-wrap gap-2">
                {state(
                    explanation.visible,
                    'form-engine.designer.inspector.shown',
                    'form-engine.designer.inspector.hidden',
                    'visible'
                )}
                {state(
                    explanation.enabled,
                    'form-engine.designer.inspector.enabled',
                    'form-engine.designer.inspector.disabled',
                    'enabled'
                )}
                {state(
                    explanation.required,
                    'form-engine.designer.inspector.required',
                    'form-engine.designer.inspector.optional',
                    'required'
                )}
            </div>
            <Rules
                title={t('form-engine.designer.inspector.visibility')}
                steps={explanation.visibility}
                labelOf={labelOf}
            />
            <Rules
                title={t('form-engine.designer.inspector.enablement')}
                steps={explanation.enablement}
                labelOf={labelOf}
            />
            {required && (
                <p className="text-sm" data-inspector-required>
                    {'always' in required
                        ? t('form-engine.designer.inspector.requiredAlways')
                        : t(
                              required.holds
                                  ? 'form-engine.designer.inspector.requiredWhenHolds'
                                  : 'form-engine.designer.inspector.requiredWhenFails',
                              { expression: required.expression }
                          )}
                </p>
            )}
        </div>
    );
}

function Rules({ title, steps, labelOf }: { title: string; steps: RuleStep[]; labelOf: (id: string) => string }) {
    const { t } = useEngineText();
    if (steps.length === 0) return null;
    return (
        <section className="grid gap-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h4>
            {steps.map((step) => (
                <div key={step.fieldId} className="rounded-md border p-3 text-sm" data-inspector-rule={step.fieldId}>
                    <p className="mb-1 flex items-center gap-2 font-medium">
                        <Verdict holds={!step.removed && step.rule.holds} />
                        {t('form-engine.designer.inspector.ruleOf', { label: step.label || step.fieldId })}
                    </p>
                    {step.removed ? (
                        <p className="text-muted-foreground">{t('form-engine.designer.inspector.removed')}</p>
                    ) : (
                        <>
                            <p className="mb-1 text-muted-foreground">
                                {t(`form-engine.designer.inspector.logic.${step.rule.logic}` as EngineMessageKey)}
                            </p>
                            <Conditions conditions={step.rule.conditions} labelOf={labelOf} />
                        </>
                    )}
                </div>
            ))}
        </section>
    );
}

function Conditions({ conditions, labelOf }: { conditions: ConditionTrace[]; labelOf: (id: string) => string }) {
    const { t } = useEngineText();
    const empty = t('form-engine.designer.inspector.emptyValue');
    return (
        <ul className="grid gap-1 ps-1">
            {conditions.map((c, i) => (
                <li key={i} className="flex items-start gap-2" data-inspector-condition={c.field} data-holds={c.holds}>
                    <Verdict holds={c.holds} muted={c.skipped} />
                    <div className="grid gap-1">
                        {c.conditions ? (
                            <>
                                <span>
                                    {t(
                                        c.operator === 'not'
                                            ? 'form-engine.designer.inspector.groupNot'
                                            : 'form-engine.designer.inspector.group'
                                    )}{' '}
                                    {t(`form-engine.designer.inspector.logic.${c.logic ?? 'and'}` as EngineMessageKey)}
                                </span>
                                <Conditions conditions={c.conditions} labelOf={labelOf} />
                            </>
                        ) : (
                            <span>
                                <strong>{labelOf(c.field)}</strong>{' '}
                                {OPERATOR.has(c.operator)
                                    ? t(OPERATOR.get(c.operator) as EngineMessageKey)
                                    : c.operator}
                                {!NO_VALUE.has(c.operator) && <> {shown(c.expected, empty)}</>}
                                <span className="text-muted-foreground">
                                    {' '}
                                    {c.skipped
                                        ? t('form-engine.designer.inspector.skipped')
                                        : t('form-engine.designer.inspector.actual', { value: shown(c.actual, empty) })}
                                </span>
                            </span>
                        )}
                    </div>
                </li>
            ))}
        </ul>
    );
}

function Verdict({ holds, muted }: { holds: boolean; muted?: boolean }) {
    const Icon = holds ? CircleCheck : CircleX;
    return (
        <Icon
            className={cn(
                'mt-0.5 size-4 shrink-0',
                muted ? 'text-muted-foreground' : holds ? 'text-success' : 'text-destructive'
            )}
            aria-hidden="true"
        />
    );
}
