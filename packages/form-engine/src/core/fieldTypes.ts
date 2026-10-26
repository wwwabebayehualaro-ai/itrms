/**
 * The field types this engine knows (the API refuses a form with any other). Kept by hand: it cannot be read from the kit
 * (React); renderer/registeredTypes.spec.ts fails when the two differ.
 */
export const FIELD_TYPES: readonly string[] = [
    'AutoComplete',
    'Calendar',
    'Card',
    'Checkbox',
    'CheckboxGroup',
    'Chips',
    'ColorPicker',
    'DataTable',
    'Divider',
    'Dropdown',
    'EthDate',
    'Fieldset',
    'FileUpload',
    'FormArray',
    'FormSection',
    'InputMask',
    'InputNumber',
    'InputSwitch',
    'InputText',
    'InputTextarea',
    'MultiSelect',
    'Panel',
    'Password',
    'RadioButton',
    'Rating',
    'RegistryLookup',
    'Slider'
];
