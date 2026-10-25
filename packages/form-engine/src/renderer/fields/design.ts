/**
 * How the form builder offers the built-in field types: palette entry, settings (a Zod object over the stored `props`, with
 * `.meta()` for the inspector) and which rule / option editors apply. The setting names are the ones templates already store,
 * so the inspector edits exactly what the renderer and the backend read.
 *
 * Metadata keys read by the inspector: `title`, `description`, `placeholder`, `labels` (enum value -> label), `multiline`,
 * `advanced` (shown under "More settings").
 */
import { z } from 'zod';
import {
    AlignJustify,
    Calendar,
    CaseSensitive,
    CircleDot,
    Hash,
    KeyRound,
    LayoutPanelTop,
    List,
    ListChecks,
    Minus,
    Palette,
    Paperclip,
    Rows3,
    SlidersHorizontal,
    Square,
    SquareCheck,
    Star,
    Table,
    Tags,
    TextCursorInput,
    ToggleRight,
    Type,
    TextSearch,
    Group,
    PanelTop
} from 'lucide-react';
import { describeFieldType } from '../kit';

const text = (title: string, extra: Record<string, unknown> = {}) =>
    z
        .string()
        .optional()
        .meta({ title, ...extra });
const num = (title: string, extra: Record<string, unknown> = {}) =>
    z
        .number()
        .optional()
        .meta({ title, ...extra });
const flag = (title: string, extra: Record<string, unknown> = {}) =>
    z
        .boolean()
        .optional()
        .meta({ title, ...extra });
const placeholder = text('Placeholder', { description: 'Hint shown inside the empty control.' });

// ---- text & numbers ---------------------------------------------------------------------------------------------------
describeFieldType('InputText', {
    label: 'Text',
    icon: Type,
    group: 'Text & numbers',
    hint: 'One line of text: a name, a title, an email address.',
    keywords: ['input', 'string', 'email', 'name'],
    rules: ['length', 'pattern'],
    settings: z.object({
        placeholder,
        type: z
            .enum(['text', 'email'])
            .optional()
            .meta({ title: 'Format', labels: { text: 'Any text', email: 'Email address' } }),
        maxLength: num('Maximum characters', { description: 'Typing stops at this length.', advanced: true })
    })
});
describeFieldType('InputTextarea', {
    label: 'Long text',
    icon: AlignJustify,
    group: 'Text & numbers',
    hint: 'Several lines: a description, a comment, a reason.',
    keywords: ['textarea', 'multiline', 'comment', 'notes'],
    rules: ['length', 'pattern'],
    settings: z.object({
        placeholder,
        rows: num('Height in lines'),
        autoResize: flag('Grow with the text')
    })
});
describeFieldType('InputNumber', {
    label: 'Number',
    icon: Hash,
    group: 'Text & numbers',
    hint: 'A number or an amount of money.',
    keywords: ['amount', 'money', 'currency', 'quantity', 'decimal'],
    rules: ['range'],
    settings: z.object({
        placeholder,
        mode: z
            .enum(['decimal', 'currency'])
            .optional()
            .meta({ title: 'Kind', labels: { decimal: 'Number', currency: 'Money' } }),
        currency: text('Currency', { description: 'ISO code, e.g. USD or EUR (for money).', placeholder: 'USD' }),
        minFractionDigits: num('Decimals at least', { advanced: true }),
        maxFractionDigits: num('Decimals at most', { advanced: true }),
        useGrouping: flag('Thousands separators', { advanced: true }),
        prefix: text('Text before', { advanced: true }),
        suffix: text('Text after', { description: 'e.g. kg or %', advanced: true })
    })
});
describeFieldType('InputMask', {
    label: 'Formatted text',
    icon: TextCursorInput,
    group: 'Text & numbers',
    hint: 'Text with a fixed pattern: a phone number, an account number.',
    keywords: ['mask', 'phone', 'pattern', 'code'],
    rules: ['pattern'],
    settings: z.object({
        mask: text('Pattern', {
            description:
                '9 = digit, a = letter, * = either, ? = the rest is optional. Other characters are typed for the person.',
            placeholder: '(999) 999-9999'
        }),
        placeholder
    })
});
describeFieldType('Password', {
    label: 'Secret',
    icon: KeyRound,
    group: 'Text & numbers',
    hint: 'Text that is hidden while typed.',
    keywords: ['password', 'pin'],
    rules: ['length', 'pattern'],
    settings: z.object({ placeholder })
});

// ---- choices ----------------------------------------------------------------------------------------------------------
const choiceSettings = z.object({
    placeholder,
    filter: flag('Search box', { description: 'Shown anyway when there are more than 7 options.' }),
    showClear: flag('Can be cleared', {
        description: 'A ✕ empties the choice (always offered when the field is optional).'
    })
});
describeFieldType('Dropdown', {
    label: 'Pick one',
    icon: List,
    group: 'Choices',
    hint: 'One choice from a list, in a menu.',
    keywords: ['select', 'dropdown', 'combo'],
    options: true,
    settings: choiceSettings
});
describeFieldType('MultiSelect', {
    label: 'Pick several',
    icon: ListChecks,
    group: 'Choices',
    hint: 'Several choices from a list, in a menu.',
    keywords: ['multi', 'select', 'tags'],
    options: true,
    settings: choiceSettings
});
describeFieldType('RadioButton', {
    label: 'Choice buttons',
    icon: CircleDot,
    group: 'Choices',
    hint: 'One choice, all options visible.',
    keywords: ['radio', 'option'],
    options: true
});
describeFieldType('CheckboxGroup', {
    label: 'Check boxes',
    icon: SquareCheck,
    group: 'Choices',
    hint: 'Several choices, all options visible.',
    keywords: ['checkbox', 'multiple'],
    options: true
});
describeFieldType('Checkbox', {
    label: 'Yes / no box',
    icon: Square,
    group: 'Choices',
    hint: 'One box to tick, e.g. "I agree".',
    keywords: ['checkbox', 'agree', 'boolean']
});
describeFieldType('InputSwitch', {
    label: 'On / off switch',
    icon: ToggleRight,
    group: 'Choices',
    hint: 'A setting that is on or off.',
    keywords: ['switch', 'toggle', 'boolean']
});
describeFieldType('AutoComplete', {
    label: 'Search and pick',
    icon: TextSearch,
    group: 'Choices',
    hint: 'Type to find one option.',
    keywords: ['autocomplete', 'search', 'lookup'],
    options: true,
    settings: z.object({ placeholder })
});
describeFieldType('Chips', {
    label: 'Tags',
    icon: Tags,
    group: 'Choices',
    hint: 'A list of short words the person types.',
    keywords: ['chips', 'tags', 'keywords'],
    settings: z.object({
        placeholder,
        separator: text('Separator', { description: 'Typing it adds a tag (Enter always does).', placeholder: ',' })
    })
});
describeFieldType('Rating', {
    label: 'Rating',
    defaults: { stars: 5 },
    icon: Star,
    group: 'Choices',
    hint: 'Stars from 1 to 5 (or more).',
    keywords: ['stars', 'score'],
    settings: z.object({ stars: num('Number of stars'), cancel: flag('Can be cleared') })
});
describeFieldType('Slider', {
    label: 'Slider',
    defaults: { min: 0, max: 100, step: 1 },
    icon: SlidersHorizontal,
    group: 'Choices',
    hint: 'A number picked on a scale.',
    keywords: ['range', 'scale'],
    settings: z.object({
        min: num('Smallest'),
        max: num('Largest'),
        step: num('Step'),
        range: flag('Pick a range (from – to)')
    })
});
describeFieldType('ColorPicker', {
    label: 'Colour',
    icon: Palette,
    group: 'Choices',
    hint: 'A colour.',
    keywords: ['color', 'colour']
});

// ---- date & time ------------------------------------------------------------------------------------------------------
describeFieldType('EthDate', {
    label: 'Date (Ethiopian calendar)',
    icon: Calendar,
    group: 'Date & time',
    hint: 'A day picked on the Ethiopian calendar (stored as the Gregorian date).',
    keywords: ['date', 'ethiopian', 'calendar', 'day', 'ቀን', 'ዓ.ም'],
    rules: ['ethDates'],
    settings: z.object({ placeholder })
});

describeFieldType('Calendar', {
    label: 'Date (Gregorian)',
    icon: Calendar,
    group: 'Date & time',
    hint: 'A day, optionally with a time.',
    keywords: ['date', 'time', 'calendar', 'day'],
    rules: ['dates'],
    settings: z.object({
        placeholder,
        showTime: flag('With time'),
        dateFormat: text('Date format', {
            description: 'dd = day, mm = month, yy = year, e.g. dd.mm.yy',
            placeholder: 'mm/dd/yy',
            advanced: true
        }),
        hourFormat: z
            .enum(['24', '12'])
            .optional()
            .meta({ title: 'Clock', labels: { '24': '24 hours', '12': '12 hours (am/pm)' }, advanced: true })
    })
});

// ---- files ------------------------------------------------------------------------------------------------------------
describeFieldType('FileUpload', {
    label: 'Files',
    icon: Paperclip,
    group: 'Files & media',
    hint: 'Attachments: receipts, scans, documents.',
    keywords: ['upload', 'attachment', 'document', 'file'],
    rules: ['files'],
    settings: z.object({
        multiple: flag('Several files'),
        chooseLabel: text('Button text', { placeholder: 'Choose files' })
    })
});

// ---- layout -----------------------------------------------------------------------------------------------------------
const collapsible = { toggleable: flag('Can be collapsed'), collapsed: flag('Starts collapsed') };
describeFieldType('Panel', {
    label: 'Panel',
    icon: PanelTop,
    group: 'Layout',
    hint: 'A titled box around related fields.',
    keywords: ['container', 'box', 'group'],
    settings: z.object({
        header: text('Title', { description: 'Shown instead of the label when set.' }),
        ...collapsible
    })
});
describeFieldType('Fieldset', {
    label: 'Group',
    icon: Group,
    group: 'Layout',
    hint: 'A light frame with a title on its border.',
    keywords: ['fieldset', 'group', 'container'],
    settings: z.object({
        legend: text('Title', { description: 'Shown instead of the label when set.' }),
        ...collapsible
    })
});
describeFieldType('Card', {
    label: 'Card',
    icon: LayoutPanelTop,
    group: 'Layout',
    hint: 'A card with a title, a subtitle and a footer.',
    keywords: ['card', 'container'],
    settings: z.object({
        title: text('Title', { description: 'Shown instead of the label when set.' }),
        subTitle: text('Subtitle'),
        footer: text('Footer text')
    })
});
describeFieldType('FormSection', {
    label: 'Section',
    icon: CaseSensitive,
    group: 'Layout',
    hint: 'A heading with a description above a group of fields.',
    keywords: ['section', 'heading'],
    settings: z.object({
        title: text('Heading', { description: 'Shown instead of the label when set.' }),
        description: text('Description', { multiline: true })
    })
});
describeFieldType('Divider', {
    label: 'Divider',
    leaf: true,
    icon: Minus,
    group: 'Layout',
    hint: 'A line between parts of the form, optionally with a word on it.',
    keywords: ['separator', 'line', 'hr'],
    settings: z.object({
        content: text('Text on the line'),
        type: z
            .enum(['solid', 'dashed'])
            .optional()
            .meta({ title: 'Line', labels: { solid: 'Solid', dashed: 'Dashed' } })
    })
});
describeFieldType('FormArray', {
    label: 'Repeating rows',
    defaults: { minItems: 1, itemLabel: 'Item', addButtonLabel: 'Add row' },
    icon: Rows3,
    group: 'Layout',
    hint: 'Rows the person can add, each with the fields you put inside (expense lines, items).',
    keywords: ['repeat', 'rows', 'lines', 'array', 'items', 'list'],
    rules: ['items'],
    settings: z.object({
        itemLabel: text('A row is called', { placeholder: 'Item' }),
        addButtonLabel: text('Add button text', { placeholder: 'Add row' }),
        removeButtonLabel: text('Remove button tooltip', { placeholder: 'Remove', advanced: true }),
        emptyMessage: text('Text when there are no rows', { advanced: true })
    })
});

// ---- data -------------------------------------------------------------------------------------------------------------
describeFieldType('DataTable', {
    label: 'Table of data',
    defaults: { columns: [], showSearch: true, paginator: true, rows: 10 },
    icon: Table,
    group: 'Data',
    hint: 'Shows records from a data source (or fixed rows) with search, sorting and export.',
    keywords: ['table', 'grid', 'report', 'list'],
    settings: z.object({
        showSearch: flag('Search box'),
        allowExport: flag('CSV export'),
        paginator: flag('Pages'),
        rows: num('Rows per page'),
        showView: flag('View button', { advanced: true }),
        showEdit: flag('Edit button', { advanced: true }),
        showDelete: flag('Delete button', { advanced: true })
    })
});
