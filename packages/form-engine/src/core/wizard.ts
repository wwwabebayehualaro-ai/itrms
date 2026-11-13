/**
 * Wizard steps (task 1.13c, form-platform.md §5): a form whose top level holds `FormStep` containers is filled one step at a time.
 * The values are one form's, kept across the steps; each step is checked before the next, and the server checks the whole form as
 * it always does (a step is a container: it holds no value of its own). Fields outside every step come on the last one.
 * UI-free: the renderer and its tests read these.
 */
import type { FieldErrors } from './validate';
import type { EngineField } from './model';

export const STEP_TYPE = 'FormStep';

/** The form's steps in order: its top-level steps, a removed one left out (none: the form is not a wizard). */
export function wizardSteps(fields: readonly EngineField[]): EngineField[] {
    return fields.filter((f) => f.type === STEP_TYPE && !f.parentId && !f.removed);
}

/** The step a field is in (its top-level container, when that is a step); null for a field outside every step. */
export function stepOf(id: string, byId: ReadonlyMap<string, EngineField>): string | null {
    let at = byId.get(id);
    for (let depth = 0; at?.parentId && depth <= byId.size; depth++) at = byId.get(at.parentId);
    return at?.type === STEP_TYPE && !at.parentId ? at.id : null;
}

/** The field an error's key names: its first segment (`rows[0].x` and `rows.x` are the `rows` section's). */
export const errorField = (key: string): string => key.split(/[.[]/)[0] ?? key;

/** The errors of one step; with `null`, those of the fields outside every step. */
export function errorsOfStep(
    errors: FieldErrors,
    step: string | null,
    byId: ReadonlyMap<string, EngineField>
): FieldErrors {
    return Object.fromEntries(Object.entries(errors).filter(([key]) => stepOf(errorField(key), byId) === step));
}

/**
 * Where the person is sent when the form cannot be submitted: the first step, in order, that holds an error (an error outside every
 * step is shown on the last step). Undefined without errors.
 */
export function firstStepWithErrors(
    errors: FieldErrors,
    steps: readonly Pick<EngineField, 'id'>[],
    byId: ReadonlyMap<string, EngineField>
): string | undefined {
    const keys = Object.keys(errors);
    if (keys.length === 0) return undefined;
    const holding = new Set(keys.map((k) => stepOf(errorField(k), byId)));
    const found = steps.find((s) => holding.has(s.id));
    return found?.id ?? steps[steps.length - 1]?.id;
}
