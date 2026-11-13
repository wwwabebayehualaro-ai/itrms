/**
 * The logic inspector (task 1.13c, form-platform.md §6): why a field is hidden, disabled or required now, with the values that
 * decided it. It walks the same rules the renderer and the server apply (the field's own, then each container's around it) and
 * gives the same answers; nothing is decided here that `isVisibleIn`, `isEnabledIn` or `isRequiredIn` would decide otherwise.
 */
import { explainAll, type ListTrace, type Scope } from './conditions';
import { isRequiredIn, type EngineField } from './model';
import { isEnabledIn, isVisibleIn } from './values';

/** One field's rule on the way: the field itself or a container around it. */
export interface RuleStep {
    fieldId: string;
    label: string;
    /** a published key taken out of the form: never shown, whatever its rules */
    removed?: boolean;
    rule: ListTrace;
}

export interface FieldExplanation {
    fieldId: string;
    visible: boolean;
    enabled: boolean;
    required: boolean;
    /** the visibility rules from the field outwards (only fields that have one, or are removed) */
    visibility: RuleStep[];
    /** the enablement rules from the field outwards (only fields that have one) */
    enablement: RuleStep[];
    /** why it is required: always (the author's Required), or while its formula holds */
    requiredBy: { always: true } | { expression: string; holds: boolean } | null;
}

function chain(field: EngineField, byId: ReadonlyMap<string, EngineField>, stopAt: string | null): EngineField[] {
    const out: EngineField[] = [];
    // a stored form's parents never loop (checkDocument refuses that), but the walk is bounded all the same
    for (
        let f: EngineField | undefined = field;
        f && f.id !== stopAt && out.length <= byId.size;
        f = f.parentId ? byId.get(f.parentId) : undefined
    )
        out.push(f);
    return out;
}

/**
 * Why `field` is as it is for these values. `values` are the values of its scope (the form, or the row it is in), `root` the
 * whole form, `scope` the runtime's (`user`, data sources); `stopAt` the repeatable section a row field's rules stop at.
 */
export function explainField(
    field: EngineField,
    byId: ReadonlyMap<string, EngineField>,
    values: Record<string, unknown>,
    options: { root?: Record<string, unknown>; scope?: Scope; stopAt?: string | null } = {}
): FieldExplanation {
    const scope = options.scope ?? {};
    const stopAt = options.stopAt ?? null;
    const map = byId as Map<string, EngineField>;
    const around = chain(field, byId, stopAt);
    const step = (f: EngineField, rule: ListTrace, removed?: boolean): RuleStep => ({
        fieldId: f.id,
        label: f.label,
        ...(removed ? { removed } : {}),
        rule
    });
    const visibility = around
        .filter((f) => f.removed || f.visibleWhen.length > 0)
        .map((f) => step(f, explainAll(f.visibleWhen, values, scope), f.removed || undefined));
    const enablement = around
        .filter((f) => f.enabledWhen.length > 0)
        .map((f) => step(f, explainAll(f.enabledWhen, values, scope)));
    const visible = isVisibleIn(field, map, values, scope, stopAt);
    const required = isRequiredIn(field, values, options.root ?? values, scope);
    return {
        fieldId: field.id,
        visible,
        enabled: visible && isEnabledIn(field, map, values, scope, stopAt),
        required,
        visibility,
        enablement,
        requiredBy: field.rules.required
            ? { always: true }
            : field.rules.requiredWhen
              ? { expression: field.rules.requiredWhen, holds: required }
              : null
    };
}
