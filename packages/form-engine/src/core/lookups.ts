/**
 * The registry records a form's answers point to (task 0.18): the server checks each of them exists and is usable. UI-free.
 */
import type { Scope } from './conditions';
import { isFormArray, type EngineField } from './model';
import { scopeFields, knownValues, pruneHidden } from './values';

export interface LookupRef {
    /** where the answer sits: the field id, or `members[0].person` inside a repeatable section's row */
    path: string;
    /** the registry provider the field reads (`person`, `organisation`) */
    provider: string;
    /** the record's id, as submitted */
    id: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Every lookup answer of a submission, with its provider. Answers of hidden fields are left out (they are not stored), blanks
 * and values that are not text are left out too (the shape check reports those).
 */
export function lookupRefs(fields: EngineField[], answers: Record<string, unknown>, scope: Scope = {}): LookupRef[] {
    const visible = pruneHidden(fields, knownValues(fields, answers), scope);
    const out: LookupRef[] = [];
    const walk = (parentId: string | null, current: Record<string, unknown>, prefix: string) => {
        for (const f of scopeFields(fields, parentId)) {
            if (!Object.hasOwn(current, f.id)) continue;
            const v = current[f.id];
            const path = `${prefix}${f.id}`;
            if (isFormArray(f)) {
                if (Array.isArray(v)) v.forEach((row, i) => isRecord(row) && walk(f.id, row, `${path}[${i}].`));
            } else if (f.type === 'RegistryLookup' && typeof v === 'string' && v !== '') {
                const provider = f.props.provider;
                if (typeof provider === 'string' && provider !== '') out.push({ path, provider, id: v });
            }
        }
    };
    walk(null, visible, '');
    return out;
}
