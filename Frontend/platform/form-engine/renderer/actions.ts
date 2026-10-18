/**
 * Field actions (`behavior.actions.onChange / onBlur / onFocus`): navigate, call a data source, set values, refetch, raise a window
 * event, or run a handler registered in code (`registerAction`). Templates carry no code: every action is one of these kinds, and
 * API calls only go through the form's data sources (one place for auth, URL safety and headers).
 */
import type { Action } from '../core/storedTypes';
import { getActionHandler } from '../extensions';
import { resolveBindings, resolveString } from '../Runtime/expression';
import { evaluateAll } from '../core';

export interface ActionOptions {
    formValues: Record<string, any>;
    /** `data`, `user`, `route`, `variables`, `root`, plus `eventData` / `fieldId`. */
    context?: Record<string, any>;
    /** Runs a template data source by id through the shared authenticated client. */
    runApi?: (dataSourceId: string, bodyOverride?: unknown) => Promise<any>;
    setFieldValue?: (field: string, value: any) => void;
    refetch?: (dataSourceId?: string) => Promise<void>;
    onSuccess?: (result: any) => void;
    onError?: (error: Error) => void;
}

const scopeOf = (o: ActionOptions) => ({ form: o.formValues, ...o.context });

/** payload: `{ field, value }` or `{ values: { fieldId: value } }`; values may be `{{bindings}}`. */
function setValues(action: Action, o: ActionOptions) {
    const scope = scopeOf(o);
    const values: Record<string, any> = action.payload?.values ?? (action.payload?.field ? { [action.payload.field]: action.payload.value } : {});
    Object.entries(values).forEach(([field, value]) => o.setFieldValue?.(field, resolveBindings(value, scope)));
}

export async function runAction(action: Action, o: ActionOptions): Promise<any> {
    const context = o.context ?? {};
    if (action.conditions?.length && !evaluateAll(action.conditions, o.formValues, context)) return undefined;
    try {
        let result: any;
        switch (action.type) {
            case 'navigate': {
                const url = String(resolveString(action.target || '#', scopeOf(o)) ?? '');
                if (/^\s*(javascript|data|vbscript):/i.test(url)) throw new Error('Unsafe navigation target');
                if (action.meta?.newTab) window.open(url, '_blank', 'noopener,noreferrer');
                else window.location.href = url;
                break;
            }
            case 'apiCall': {
                const dataSourceId = action.payload?.dataSourceId ?? action.target;
                if (!dataSourceId || !o.runApi) throw new Error('apiCall actions need a data source id and a runtime');
                const body = action.payload?.body !== undefined ? resolveBindings(action.payload.body, scopeOf(o)) : undefined;
                result = await o.runApi(dataSourceId, body);
                if (action.onSuccess) {
                    const next = { ...o, context: { ...context, response: result } };
                    await Promise.all(action.onSuccess.map((a) => runAction(a, next)));
                }
                o.onSuccess?.(result);
                break;
            }
            case 'stateUpdate': // older name of setValue, kept for stored templates
            case 'setValue':
                setValues(action, o);
                break;
            case 'refetch':
                await o.refetch?.(action.target || undefined);
                break;
            case 'event':
                window.dispatchEvent(new CustomEvent(action.target || 'formAction', { detail: { action, formValues: o.formValues, context }, bubbles: true, cancelable: true }));
                break;
            case 'custom': {
                // only handlers registered in code run: a stored template cannot carry executable code
                const handler = action.target ? getActionHandler(action.target) : undefined;
                if (handler) result = await handler({ payload: action.payload, formValues: o.formValues, context, setFieldValue: o.setFieldValue, runApi: o.runApi, refetch: o.refetch });
                break;
            }
            default:
                console.warn('Unknown action type:', action.type);
        }
        return result;
    } catch (error) {
        if (action.onError) await Promise.all(action.onError.map((a) => runAction(a, o)));
        o.onError?.(error as Error);
        throw error;
    }
}
