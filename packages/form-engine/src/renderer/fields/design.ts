/**
 * How the form builder offers the built-in field types: palette entry, settings (a Zod object over the stored `props`, with
 * `.meta()` for the inspector) and which rule / option editors apply. The setting names are the ones templates already store,
 * so the inspector edits exactly what the renderer and the backend read.
 *
 * Metadata keys read by the inspector (`setting()` types them): `title`, `description`, `placeholder`, `labels` (enum value ->
 * label), `multiline`, `advanced` (shown under "More settings"). Every word is a key of the `palette` / `settings` catalogues.
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
import { describeFieldType, setting, type SettingMeta } from '../kit';

const text = (meta: SettingMeta) => setting(z.string().optional(), meta);
const num = (meta: SettingMeta) => setting(z.number().optional(), meta);
const flag = (meta: SettingMeta) => setting(z.boolean().optional(), meta);
const placeholder = text({
    title: 'form-engine.settings.shared.placeholder.title',
    description: 'form-engine.settings.shared.placeholder.description'
});

// ---- text & numbers ---------------------------------------------------------------------------------------------------
describeFieldType('InputText', {
    label: 'form-engine.palette.type.InputText.label',
    icon: Type,
    group: 'text',
    hint: 'form-engine.palette.type.InputText.hint',
    keywords: ['input', 'string', 'email', 'name'],
    rules: ['length', 'pattern'],
    settings: z.object({
        placeholder,
        type: setting(z.enum(['text', 'email']).optional(), {
            title: 'form-engine.settings.InputText.type.title',
            labels: {
                text: 'form-engine.settings.InputText.type.text',
                email: 'form-engine.settings.InputText.type.email'
            }
        }),
        maxLength: num({
            title: 'form-engine.settings.InputText.maxLength.title',
            description: 'form-engine.settings.InputText.maxLength.description',
            advanced: true
        })
    })
});
describeFieldType('InputTextarea', {
    label: 'form-engine.palette.type.InputTextarea.label',
    icon: AlignJustify,
    group: 'text',
    hint: 'form-engine.palette.type.InputTextarea.hint',
    keywords: ['textarea', 'multiline', 'comment', 'notes'],
    rules: ['length', 'pattern'],
    settings: z.object({
        placeholder,
        rows: num({ title: 'form-engine.settings.InputTextarea.rows.title' }),
        autoResize: flag({ title: 'form-engine.settings.InputTextarea.autoResize.title' })
    })
});
describeFieldType('InputNumber', {
    label: 'form-engine.palette.type.InputNumber.label',
    icon: Hash,
    group: 'text',
    hint: 'form-engine.palette.type.InputNumber.hint',
    keywords: ['amount', 'money', 'currency', 'quantity', 'decimal'],
    rules: ['range'],
    settings: z.object({
        placeholder,
        mode: setting(z.enum(['decimal', 'currency']).optional(), {
            title: 'form-engine.settings.InputNumber.mode.title',
            labels: {
                decimal: 'form-engine.settings.InputNumber.mode.decimal',
                currency: 'form-engine.settings.InputNumber.mode.currency'
            }
        }),
        currency: text({
            title: 'form-engine.settings.InputNumber.currency.title',
            description: 'form-engine.settings.InputNumber.currency.description',
            placeholder: 'USD'
        }),
        minFractionDigits: num({
            title: 'form-engine.settings.InputNumber.minFractionDigits.title',
            advanced: true
        }),
        maxFractionDigits: num({
            title: 'form-engine.settings.InputNumber.maxFractionDigits.title',
            advanced: true
        }),
        useGrouping: flag({ title: 'form-engine.settings.InputNumber.useGrouping.title', advanced: true }),
        prefix: text({ title: 'form-engine.settings.InputNumber.prefix.title', advanced: true }),
        suffix: text({
            title: 'form-engine.settings.InputNumber.suffix.title',
            description: 'form-engine.settings.InputNumber.suffix.description',
            advanced: true
        })
    })
});
describeFieldType('InputMask', {
    label: 'form-engine.palette.type.InputMask.label',
    icon: TextCursorInput,
    group: 'text',
    hint: 'form-engine.palette.type.InputMask.hint',
    keywords: ['mask', 'phone', 'pattern', 'code'],
    rules: ['pattern'],
    settings: z.object({
        mask: text({
            title: 'form-engine.settings.InputMask.mask.title',
            description: 'form-engine.settings.InputMask.mask.description',
            placeholder: '(999) 999-9999'
        }),
        placeholder
    })
});
describeFieldType('Password', {
    label: 'form-engine.palette.type.Password.label',
    icon: KeyRound,
    group: 'text',
    hint: 'form-engine.palette.type.Password.hint',
    keywords: ['password', 'pin'],
    rules: ['length', 'pattern'],
    settings: z.object({ placeholder })
});

// ---- choices ----------------------------------------------------------------------------------------------------------
const choiceSettings = z.object({
    placeholder,
    filter: flag({
        title: 'form-engine.settings.shared.filter.title',
        description: 'form-engine.settings.shared.filter.description'
    }),
    showClear: flag({
        title: 'form-engine.settings.shared.showClear.title',
        description: 'form-engine.settings.shared.showClear.description'
    })
});
describeFieldType('Dropdown', {
    label: 'form-engine.palette.type.Dropdown.label',
    icon: List,
    group: 'choices',
    hint: 'form-engine.palette.type.Dropdown.hint',
    keywords: ['select', 'dropdown', 'combo'],
    options: true,
    settings: choiceSettings
});
describeFieldType('MultiSelect', {
    label: 'form-engine.palette.type.MultiSelect.label',
    icon: ListChecks,
    group: 'choices',
    hint: 'form-engine.palette.type.MultiSelect.hint',
    keywords: ['multi', 'select', 'tags'],
    options: true,
    settings: choiceSettings
});
describeFieldType('RadioButton', {
    label: 'form-engine.palette.type.RadioButton.label',
    icon: CircleDot,
    group: 'choices',
    hint: 'form-engine.palette.type.RadioButton.hint',
    keywords: ['radio', 'option'],
    options: true
});
describeFieldType('CheckboxGroup', {
    label: 'form-engine.palette.type.CheckboxGroup.label',
    icon: SquareCheck,
    group: 'choices',
    hint: 'form-engine.palette.type.CheckboxGroup.hint',
    keywords: ['checkbox', 'multiple'],
    options: true
});
describeFieldType('Checkbox', {
    label: 'form-engine.palette.type.Checkbox.label',
    icon: Square,
    group: 'choices',
    hint: 'form-engine.palette.type.Checkbox.hint',
    keywords: ['checkbox', 'agree', 'boolean']
});
describeFieldType('InputSwitch', {
    label: 'form-engine.palette.type.InputSwitch.label',
    icon: ToggleRight,
    group: 'choices',
    hint: 'form-engine.palette.type.InputSwitch.hint',
    keywords: ['switch', 'toggle', 'boolean']
});
describeFieldType('AutoComplete', {
    label: 'form-engine.palette.type.AutoComplete.label',
    icon: TextSearch,
    group: 'choices',
    hint: 'form-engine.palette.type.AutoComplete.hint',
    keywords: ['autocomplete', 'search', 'lookup'],
    options: true,
    settings: z.object({ placeholder })
});
describeFieldType('Chips', {
    label: 'form-engine.palette.type.Chips.label',
    icon: Tags,
    group: 'choices',
    hint: 'form-engine.palette.type.Chips.hint',
    keywords: ['chips', 'tags', 'keywords'],
    settings: z.object({
        placeholder,
        separator: text({
            title: 'form-engine.settings.Chips.separator.title',
            description: 'form-engine.settings.Chips.separator.description',
            placeholder: ','
        })
    })
});
describeFieldType('Rating', {
    label: 'form-engine.palette.type.Rating.label',
    defaults: { stars: 5 },
    icon: Star,
    group: 'choices',
    hint: 'form-engine.palette.type.Rating.hint',
    keywords: ['stars', 'score'],
    settings: z.object({
        stars: num({ title: 'form-engine.settings.Rating.stars.title' }),
        cancel: flag({ title: 'form-engine.settings.Rating.cancel.title' })
    })
});
describeFieldType('Slider', {
    label: 'form-engine.palette.type.Slider.label',
    defaults: { min: 0, max: 100, step: 1 },
    icon: SlidersHorizontal,
    group: 'choices',
    hint: 'form-engine.palette.type.Slider.hint',
    keywords: ['range', 'scale'],
    settings: z.object({
        min: num({ title: 'form-engine.settings.Slider.min.title' }),
        max: num({ title: 'form-engine.settings.Slider.max.title' }),
        step: num({ title: 'form-engine.settings.Slider.step.title' }),
        range: flag({ title: 'form-engine.settings.Slider.range.title' })
    })
});
describeFieldType('ColorPicker', {
    label: 'form-engine.palette.type.ColorPicker.label',
    icon: Palette,
    group: 'choices',
    hint: 'form-engine.palette.type.ColorPicker.hint',
    keywords: ['color', 'colour']
});

// ---- date & time ------------------------------------------------------------------------------------------------------
describeFieldType('EthDate', {
    label: 'form-engine.palette.type.EthDate.label',
    icon: Calendar,
    group: 'dates',
    hint: 'form-engine.palette.type.EthDate.hint',
    keywords: ['date', 'ethiopian', 'calendar', 'day', 'ቀን', 'ዓ.ም'],
    rules: ['ethDates'],
    settings: z.object({ placeholder })
});

describeFieldType('Calendar', {
    label: 'form-engine.palette.type.Calendar.label',
    icon: Calendar,
    group: 'dates',
    hint: 'form-engine.palette.type.Calendar.hint',
    keywords: ['date', 'time', 'calendar', 'day'],
    rules: ['dates'],
    settings: z.object({
        placeholder,
        showTime: flag({ title: 'form-engine.settings.Calendar.showTime.title' }),
        dateFormat: text({
            title: 'form-engine.settings.Calendar.dateFormat.title',
            description: 'form-engine.settings.Calendar.dateFormat.description',
            placeholder: 'mm/dd/yy',
            advanced: true
        }),
        hourFormat: setting(z.enum(['24', '12']).optional(), {
            title: 'form-engine.settings.Calendar.hourFormat.title',
            labels: {
                '24': 'form-engine.settings.Calendar.hourFormat.24',
                '12': 'form-engine.settings.Calendar.hourFormat.12'
            },
            advanced: true
        })
    })
});

// ---- files ------------------------------------------------------------------------------------------------------------
describeFieldType('FileUpload', {
    label: 'form-engine.palette.type.FileUpload.label',
    icon: Paperclip,
    group: 'files',
    hint: 'form-engine.palette.type.FileUpload.hint',
    keywords: ['upload', 'attachment', 'document', 'file'],
    rules: ['files'],
    settings: z.object({
        multiple: flag({ title: 'form-engine.settings.FileUpload.multiple.title' }),
        chooseLabel: text({
            title: 'form-engine.settings.FileUpload.chooseLabel.title',
            placeholderWord: 'form-engine.settings.FileUpload.chooseLabel.placeholder'
        })
    })
});

// ---- layout -----------------------------------------------------------------------------------------------------------
const printBreak = {
    printBreakBefore: flag({ title: 'form-engine.settings.shared.printBreakBefore.title', advanced: true })
};
const collapsible = {
    toggleable: flag({ title: 'form-engine.settings.shared.toggleable.title' }),
    collapsed: flag({ title: 'form-engine.settings.shared.collapsed.title' })
};
describeFieldType('Panel', {
    label: 'form-engine.palette.type.Panel.label',
    icon: PanelTop,
    group: 'layout',
    hint: 'form-engine.palette.type.Panel.hint',
    keywords: ['container', 'box', 'group'],
    settings: z.object({
        header: text({
            title: 'form-engine.settings.Panel.header.title',
            description: 'form-engine.settings.Panel.header.description'
        }),
        ...collapsible,
        ...printBreak
    })
});
describeFieldType('Fieldset', {
    label: 'form-engine.palette.type.Fieldset.label',
    icon: Group,
    group: 'layout',
    hint: 'form-engine.palette.type.Fieldset.hint',
    keywords: ['fieldset', 'group', 'container'],
    settings: z.object({
        legend: text({
            title: 'form-engine.settings.Fieldset.legend.title',
            description: 'form-engine.settings.Fieldset.legend.description'
        }),
        ...collapsible,
        ...printBreak
    })
});
describeFieldType('Card', {
    label: 'form-engine.palette.type.Card.label',
    icon: LayoutPanelTop,
    group: 'layout',
    hint: 'form-engine.palette.type.Card.hint',
    keywords: ['card', 'container'],
    settings: z.object({
        title: text({
            title: 'form-engine.settings.Card.title.title',
            description: 'form-engine.settings.Card.title.description'
        }),
        subTitle: text({ title: 'form-engine.settings.Card.subTitle.title' }),
        footer: text({ title: 'form-engine.settings.Card.footer.title' }),
        ...printBreak
    })
});
describeFieldType('FormSection', {
    label: 'form-engine.palette.type.FormSection.label',
    icon: CaseSensitive,
    group: 'layout',
    hint: 'form-engine.palette.type.FormSection.hint',
    keywords: ['section', 'heading'],
    settings: z.object({
        title: text({
            title: 'form-engine.settings.FormSection.title.title',
            description: 'form-engine.settings.FormSection.title.description'
        }),
        description: text({ title: 'form-engine.settings.FormSection.description.title', multiline: true }),
        ...printBreak
    })
});
describeFieldType('Divider', {
    label: 'form-engine.palette.type.Divider.label',
    leaf: true,
    icon: Minus,
    group: 'layout',
    hint: 'form-engine.palette.type.Divider.hint',
    keywords: ['separator', 'line', 'hr'],
    settings: z.object({
        content: text({ title: 'form-engine.settings.Divider.content.title' }),
        type: setting(z.enum(['solid', 'dashed']).optional(), {
            title: 'form-engine.settings.Divider.type.title',
            labels: {
                solid: 'form-engine.settings.Divider.type.solid',
                dashed: 'form-engine.settings.Divider.type.dashed'
            }
        })
    })
});
// the row and button names start empty: the renderer words them for the person who reads the form
describeFieldType('FormArray', {
    label: 'form-engine.palette.type.FormArray.label',
    defaults: { minItems: 1 },
    icon: Rows3,
    group: 'layout',
    hint: 'form-engine.palette.type.FormArray.hint',
    keywords: ['repeat', 'rows', 'lines', 'array', 'items', 'list'],
    rules: ['items'],
    settings: z.object({
        itemLabel: text({
            title: 'form-engine.settings.FormArray.itemLabel.title',
            placeholderWord: 'form-engine.settings.FormArray.itemLabel.placeholder'
        }),
        addButtonLabel: text({
            title: 'form-engine.settings.FormArray.addButtonLabel.title',
            placeholderWord: 'form-engine.settings.FormArray.addButtonLabel.placeholder'
        }),
        removeButtonLabel: text({
            title: 'form-engine.settings.FormArray.removeButtonLabel.title',
            placeholderWord: 'form-engine.settings.FormArray.removeButtonLabel.placeholder',
            advanced: true
        }),
        emptyMessage: text({ title: 'form-engine.settings.FormArray.emptyMessage.title', advanced: true }),
        printLayout: setting(z.enum(['auto', 'table', 'rows']).optional(), {
            title: 'form-engine.settings.FormArray.printLayout.title',
            labels: {
                auto: 'form-engine.settings.FormArray.printLayout.auto',
                table: 'form-engine.settings.FormArray.printLayout.table',
                rows: 'form-engine.settings.FormArray.printLayout.rows'
            },
            advanced: true
        }),
        ...printBreak
    })
});

// ---- data -------------------------------------------------------------------------------------------------------------
describeFieldType('DataTable', {
    label: 'form-engine.palette.type.DataTable.label',
    defaults: { columns: [], showSearch: true, paginator: true, rows: 10 },
    icon: Table,
    group: 'data',
    hint: 'form-engine.palette.type.DataTable.hint',
    keywords: ['table', 'grid', 'report', 'list'],
    settings: z.object({
        showSearch: flag({ title: 'form-engine.settings.DataTable.showSearch.title' }),
        allowExport: flag({ title: 'form-engine.settings.DataTable.allowExport.title' }),
        paginator: flag({ title: 'form-engine.settings.DataTable.paginator.title' }),
        rows: num({ title: 'form-engine.settings.DataTable.rows.title' }),
        showView: flag({ title: 'form-engine.settings.DataTable.showView.title', advanced: true }),
        showEdit: flag({ title: 'form-engine.settings.DataTable.showEdit.title', advanced: true }),
        showDelete: flag({ title: 'form-engine.settings.DataTable.showDelete.title', advanced: true })
    })
});
