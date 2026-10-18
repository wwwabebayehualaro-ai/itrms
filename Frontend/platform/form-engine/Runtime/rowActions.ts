/** Window event fired by the Edit / Delete buttons of a table row; the host screen decides what to do (see ROW_ACTION_EVENT docs). */
export const ROW_ACTION_EVENT = 'dfc:row-action';
export interface RowActionDetail {
    action: 'view' | 'edit' | 'delete';
    row: any;
    fieldId: string;
}
