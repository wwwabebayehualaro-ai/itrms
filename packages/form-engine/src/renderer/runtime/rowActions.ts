/** Window event fired by the Edit / Delete buttons of a table row; the host screen decides what to do (see ROW_ACTION_EVENT docs). */
export const ROW_ACTION_EVENT = 'dfc:row-action';
/** `Row`: the row type the listening screen knows its table holds (the event itself carries no type). */
export interface RowActionDetail<Row = unknown> {
    action: 'view' | 'edit' | 'delete';
    row: Row;
    fieldId: string;
}
