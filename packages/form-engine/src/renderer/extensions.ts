/**
 * Extension points for feature teams. Everything here is additive: built-in behaviour is unchanged unless a feature registers
 * something for the same key. Field types are added through the field kit (`defineFieldType` + `describeFieldType`, exported
 * from the package entry).
 */

// ---- custom actions -------------------------------------------------------------------------------
export interface ActionContext {
    /** Static config saved on the action in the template (`action.payload`). */
    payload: unknown;
    formValues: Record<string, unknown>;
    /** `data`, `user`, `route`, `variables`, plus `eventData`/`fieldId`. */
    context: Record<string, unknown>;
    setFieldValue?: (field: string, value: unknown) => void;
    /** Run a template data source through the authenticated client. */
    runApi?: (dataSourceId: string, body?: unknown) => Promise<unknown>;
    refetch?: (dataSourceId?: string) => Promise<void>;
}
export type ActionHandler = (ctx: ActionContext) => unknown;

const actionHandlers = new Map<string, ActionHandler>();

/** Templates reference handlers by name: `{ "type": "custom", "target": "exportPdf" }`. Serialised templates carry no code. */
export function registerAction(name: string, handler: ActionHandler): void {
    actionHandlers.set(name, handler);
}
export const getActionHandler = (name: string) => actionHandlers.get(name);
