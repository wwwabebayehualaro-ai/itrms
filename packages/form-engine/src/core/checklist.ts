/**
 * The `Checklist` field (task 1.13a): items in sections, each answered pass / fail / not applicable, or given points up to
 * its own (form-platform.md §5). UI-free: the browser and the API read a checklist's definition, check its answers and work
 * out its outcome with these same functions, and the outcome stored with the answers is always the server's (what a
 * browser sent as an outcome is replaced), so a rule, an effect or a report never reads a verdict a person typed.
 */
import {
    CHECKLIST_RESULTS,
    MAX_REMARK_LENGTH,
    checklistDefinitionSchema,
    type ChecklistAnswer,
    type ChecklistDefinition,
    type ChecklistItem,
    type ChecklistOutcome,
    type ChecklistValue
} from '@itrms/schemas';

import type { EngineTranslate } from './messages';
import type { EngineField } from './model';

export type { ChecklistDefinition, ChecklistOutcome, ChecklistValue };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The checklist a field defines, or null when its settings are not a checklist the engine can use (the save check names why). */
export function checklistOf(field: Pick<EngineField, 'props'>): ChecklistDefinition | null {
    const parsed = checklistDefinitionSchema.safeParse(field.props);
    return parsed.success ? parsed.data : null;
}

/** Every item of a checklist, in order, with its number as the sheet prints it (`2.3`: section 2, item 3). */
export function checklistItems(def: ChecklistDefinition): (ChecklistItem & { ref: string })[] {
    return def.sections.flatMap((s, i) => s.items.map((item, j) => ({ ...item, ref: `${i + 1}.${j + 1}` })));
}

/** A checklist answer is blank while no item has an answer. */
export function isBlankChecklist(v: unknown): boolean {
    if (v === undefined || v === null || v === '') return true;
    if (!isRecord(v) || !isRecord(v.items)) return false;
    return Object.values(v.items).every((a) => !isRecord(a) || (a.result === undefined && a.points === undefined));
}

/**
 * An item's answer: only an answer the value holds itself, so an item key that is also the name of something every object
 * has (`constructor`, `toString`) never reads that.
 */
const answerOf = (items: Readonly<Record<string, unknown>>, key: string): ChecklistAnswer | undefined => {
    const a = Object.hasOwn(items, key) ? items[key] : undefined;
    return isRecord(a) ? a : undefined;
};

const answered = (a: ChecklistAnswer | undefined, scoring: ChecklistDefinition['scoring']) =>
    !!a && (a.result === 'na' || (scoring === 'points' ? a.points !== undefined : a.result !== undefined));

/** An item failed: answered "fail", or given no points. */
const failedItem = (a: ChecklistAnswer | undefined, scoring: ChecklistDefinition['scoring']) =>
    !!a && a.result !== 'na' && (scoring === 'points' ? a.points === 0 : a.result === 'fail');

/**
 * The outcome of a checklist's answers. Pass/fail: the items passed out of those that apply; it passes when no item failed.
 * Points: the points given out of the points of the items that apply; it passes when no critical item failed and the total
 * reaches the pass mark. While an item is unanswered nothing is decided (`passed: null`), but what failed already shows. A
 * sheet where nothing applied never passes: nothing was checked.
 */
export function checklistOutcome(def: ChecklistDefinition, items: Readonly<Record<string, unknown>>): ChecklistOutcome {
    let total = 0;
    let max = 0;
    let open = false;
    let applied = 0;
    const failed: string[] = [];
    const criticalFailed: string[] = [];
    for (const item of checklistItems(def)) {
        const a = answerOf(items, item.key);
        if (!answered(a, def.scoring)) open = true;
        if (a?.result === 'na') continue;
        applied += 1;
        if (def.scoring === 'points') {
            max += item.points ?? 0;
            total += a?.points ?? 0;
        } else {
            max += 1;
            if (a?.result === 'pass') total += 1;
        }
        if (failedItem(a, def.scoring)) {
            failed.push(item.key);
            if (item.critical) criticalFailed.push(item.key);
        }
    }
    const passed = open
        ? null
        : applied === 0
          ? false
          : def.scoring === 'points'
            ? criticalFailed.length === 0 && (def.passMark === undefined || total >= def.passMark)
            : failed.length === 0;
    return { total, max, failed, criticalFailed, passed };
}

/**
 * The message when a checklist value is not right for its field, or undefined. `required`: every item must be answered.
 * Checks, in order, on any value, blank-looking or not: the shape (`items`, and only the server's `outcome` beside them; only
 * the field's items; each answer a known result or whole points within the item's, a remark of at most 500 characters),
 * "does not apply" where the checklist does not allow it or on a critical item, then (unless nothing is answered) every item
 * answered when required and a remark on a failed item when the checklist asks for one.
 */
export function checklistError(
    field: EngineField,
    value: unknown,
    required: boolean,
    t: EngineTranslate
): string | undefined {
    const def = checklistOf(field);
    const invalid = field.messages.type || t('form-engine.core.validation.checklistInvalid');
    const requiredMessage = () => field.messages.required || t('form-engine.core.validation.required');
    if (!def) return invalid;
    if (value === undefined || value === null || value === '') return required ? requiredMessage() : undefined;
    if (!isRecord(value) || !isRecord(value.items)) return invalid;
    if (Object.keys(value).some((k) => k !== 'items' && k !== 'outcome')) return invalid;
    const items = checklistItems(def);
    const byKey = new Map(items.map((i) => [i.key, i]));
    for (const [key, a] of Object.entries(value.items)) {
        const item = byKey.get(key);
        if (!item || !isRecord(a)) return invalid;
        if (Object.keys(a).some((k) => k !== 'result' && k !== 'points' && k !== 'remark')) return invalid;
        if (a.result !== undefined && !(CHECKLIST_RESULTS as readonly unknown[]).includes(a.result)) return invalid;
        if (a.remark !== undefined && (typeof a.remark !== 'string' || a.remark.length > MAX_REMARK_LENGTH))
            return invalid;
        if (def.scoring === 'points') {
            // an item is given points, or does not apply: never both, never a pass or a fail
            if (a.result !== undefined && a.result !== 'na') return invalid;
            if (
                a.points !== undefined &&
                (a.result === 'na' || !Number.isInteger(a.points) || (a.points as number) < 0)
            )
                return invalid;
            if (typeof a.points === 'number' && a.points > (item.points ?? 0)) return invalid;
        } else if (a.points !== undefined) return invalid;
    }
    const na = items.filter((i) => answerOf(value.items as Record<string, unknown>, i.key)?.result === 'na');
    if (!def.allowNotApplicable && na.length) return t('form-engine.core.validation.checklistNotApplicable');
    // a critical item always applies: "does not apply" would let a sheet pass without it
    const criticalNa = na.filter((i) => i.critical);
    if (criticalNa.length)
        return t('form-engine.core.validation.checklistCriticalApplies', {
            items: criticalNa.map((i) => i.ref).join(', ')
        });
    if (isBlankChecklist(value)) return required ? requiredMessage() : undefined;
    const answer = (key: string) => answerOf(value.items as Record<string, unknown>, key);
    if (required) {
        const open = items.filter((i) => !answered(answer(i.key), def.scoring));
        if (open.length)
            return (
                field.messages.required ||
                t('form-engine.core.validation.checklistUnanswered', { items: open.map((i) => i.ref).join(', ') })
            );
    }
    if (def.remarkOnFail) {
        const bare = items.filter((i) => failedItem(answer(i.key), def.scoring) && !answer(i.key)?.remark?.trim());
        if (bare.length)
            return t('form-engine.core.validation.checklistRemark', { items: bare.map((i) => i.ref).join(', ') });
    }
    return undefined;
}

/**
 * A checklist value as it is stored: its answers as sent (remarks trimmed: validation still refuses anything else in them)
 * and the outcome the server works out of them, in place of whatever outcome came with it. Nothing answered keeps no
 * outcome at all. A value that is not a checklist's is left as it is (validation refuses it).
 */
export function settledChecklist(field: EngineField, value: unknown): unknown {
    const def = checklistOf(field);
    if (!def || !isRecord(value) || !isRecord(value.items)) return value;
    const items: Record<string, unknown> = {};
    for (const [key, a] of Object.entries(value.items)) {
        if (!isRecord(a) || typeof a.remark !== 'string') {
            items[key] = a;
            continue;
        }
        const { remark, ...rest } = a;
        items[key] = remark.trim() ? { ...rest, remark: remark.trim() } : rest;
    }
    if (isBlankChecklist({ items })) return { items };
    return { items, outcome: checklistOutcome(def, items) } satisfies { items: unknown; outcome: ChecklistOutcome };
}
