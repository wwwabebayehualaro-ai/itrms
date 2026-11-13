'use client';

/**
 * The `Checklist` field (task 1.13a): the sheet's sections and items, each answered pass / fail / does not apply, or given
 * points up to its own, with a remark; the outcome under it is worked out as the server works it out (core/checklist.ts),
 * and the server's own is what is kept. The value is `{ items: { <item key>: { result?, points?, remark? } } }`.
 */
import { useId } from 'react';
import { Badge, Checkbox, Input, ToggleGroup, ToggleGroupItem, cn } from '@itrms/ui';
import type { ChecklistAnswer, ChecklistResult } from '@itrms/schemas';

import { checklistItems, checklistOf, checklistOutcome, type ChecklistDefinition } from '../../core';
import { useEngineText } from '../../host/text';
import { defineFieldType, type ValueFieldProps } from '../kit';

type Value = { items?: Record<string, ChecklistAnswer> } | null | undefined;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const answersOf = (v: Value): Record<string, ChecklistAnswer> => (isRecord(v) && isRecord(v.items) ? v.items : {});
/** A text the engine has already read in the screen's language (model.ts); anything else shows as nothing. */
const plain = (text: unknown): string => (typeof text === 'string' ? text : '');

function Outcome({ def, answers }: { def: ChecklistDefinition; answers: Record<string, ChecklistAnswer> }) {
    const { t } = useEngineText();
    const outcome = checklistOutcome(def, answers);
    const counts = { total: outcome.total, max: outcome.max };
    const refs = new Map(checklistItems(def).map((i) => [i.key, i.ref]));
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status" data-checklist-outcome>
            <Badge
                variant={outcome.passed === null ? 'outline' : outcome.passed ? 'default' : 'destructive'}
                data-passed={outcome.passed === null ? 'open' : String(outcome.passed)}
            >
                {outcome.passed === null
                    ? t('form-engine.renderer.checklist.open', counts)
                    : outcome.passed
                      ? t('form-engine.renderer.checklist.passed', counts)
                      : t('form-engine.renderer.checklist.failed', counts)}
            </Badge>
            {outcome.failed.length > 0 && (
                <span className="text-muted-foreground">
                    {t('form-engine.renderer.checklist.failedItems', {
                        items: outcome.failed.map((k) => refs.get(k) ?? k).join(', ')
                    })}
                </span>
            )}
        </div>
    );
}

function ChecklistField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<Value>) {
    const { t } = useEngineText();
    const base = useId();
    const def = checklistOf(field);
    if (!def)
        return (
            <p id={id} className="text-sm text-destructive">
                {t('form-engine.renderer.checklist.notUsable')}
            </p>
        );
    const answers = answersOf(value);
    const set = (key: string, next: ChecklistAnswer | undefined) => {
        const items = { ...answers };
        if (next && (next.result !== undefined || next.points !== undefined || next.remark)) items[key] = next;
        else delete items[key];
        onChange({ items });
    };
    const points = def.scoring === 'points';

    return (
        <div
            id={id}
            role="group"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="flex flex-col gap-4"
            data-checklist={field.id}
        >
            {def.sections.map((section, si) => (
                <fieldset key={section.key} className="flex flex-col gap-2" data-section={section.key}>
                    {section.title && (
                        <legend className="text-sm font-medium">
                            {si + 1}. {plain(section.title)}
                        </legend>
                    )}
                    <ol className="flex flex-col divide-y rounded-md border">
                        {section.items.map((item, ii) => {
                            const ref = `${si + 1}.${ii + 1}`;
                            const a = answers[item.key] ?? {};
                            const label = `${ref} ${plain(item.text)}`;
                            const failed = a.result === 'fail' || (points && a.points === 0);
                            return (
                                <li
                                    key={item.key}
                                    className={cn(
                                        'flex flex-col gap-2 p-2 sm:flex-row sm:items-start',
                                        failed && 'bg-destructive/5'
                                    )}
                                    data-item={item.key}
                                >
                                    <div className="flex-1 text-sm">
                                        <span className="me-1 text-muted-foreground">{ref}</span>
                                        <span id={`${base}-${item.key}`}>{plain(item.text)}</span>
                                        {item.critical && (
                                            <Badge variant="outline" className="ms-2">
                                                {t('form-engine.renderer.checklist.critical')}
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {points ? (
                                            <>
                                                <Input
                                                    type="number"
                                                    inputMode="numeric"
                                                    className="w-20"
                                                    min={0}
                                                    max={item.points}
                                                    step={1}
                                                    disabled={disabled || a.result === 'na'}
                                                    aria-label={t('form-engine.renderer.checklist.pointsFor', {
                                                        item: label,
                                                        max: item.points ?? 0
                                                    })}
                                                    value={a.points ?? ''}
                                                    onChange={(e) => {
                                                        const raw = e.target.value;
                                                        const n = raw === '' ? undefined : Number(raw);
                                                        set(item.key, {
                                                            ...a,
                                                            result: undefined,
                                                            points:
                                                                n !== undefined && Number.isFinite(n) ? n : undefined
                                                        });
                                                    }}
                                                    onBlur={onBlur}
                                                />
                                                <span className="text-sm text-muted-foreground">
                                                    {t('form-engine.renderer.checklist.outOf', {
                                                        max: item.points ?? 0
                                                    })}
                                                </span>
                                                {def.allowNotApplicable && (
                                                    <label className="flex items-center gap-1 text-sm">
                                                        <Checkbox
                                                            checked={a.result === 'na'}
                                                            disabled={disabled}
                                                            onCheckedChange={(on) =>
                                                                set(item.key, {
                                                                    ...a,
                                                                    points: undefined,
                                                                    result: on === true ? 'na' : undefined
                                                                })
                                                            }
                                                        />
                                                        {t('form-engine.renderer.checklist.na')}
                                                    </label>
                                                )}
                                            </>
                                        ) : (
                                            <ToggleGroup
                                                type="single"
                                                variant="outline"
                                                size="sm"
                                                disabled={disabled}
                                                aria-label={t('form-engine.renderer.checklist.answerFor', {
                                                    item: label
                                                })}
                                                value={a.result ?? ''}
                                                onValueChange={(v) => {
                                                    set(item.key, {
                                                        ...a,
                                                        result: (v || undefined) as ChecklistResult | undefined
                                                    });
                                                    onBlur();
                                                }}
                                            >
                                                <ToggleGroupItem value="pass">
                                                    {t('form-engine.renderer.checklist.pass')}
                                                </ToggleGroupItem>
                                                <ToggleGroupItem value="fail">
                                                    {t('form-engine.renderer.checklist.fail')}
                                                </ToggleGroupItem>
                                                {def.allowNotApplicable && (
                                                    <ToggleGroupItem value="na">
                                                        {t('form-engine.renderer.checklist.na')}
                                                    </ToggleGroupItem>
                                                )}
                                            </ToggleGroup>
                                        )}
                                        <Input
                                            className="w-48"
                                            maxLength={500}
                                            disabled={disabled}
                                            placeholder={t('form-engine.renderer.checklist.remark')}
                                            aria-label={t('form-engine.renderer.checklist.remarkFor', { item: label })}
                                            aria-required={(def.remarkOnFail && failed) || undefined}
                                            value={a.remark ?? ''}
                                            onChange={(e) =>
                                                set(item.key, { ...a, remark: e.target.value || undefined })
                                            }
                                            onBlur={onBlur}
                                        />
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                </fieldset>
            ))}
            <Outcome def={def} answers={answers} />
        </div>
    );
}

defineFieldType<Value>({ kind: 'value', type: 'Checklist', Render: ChecklistField });
