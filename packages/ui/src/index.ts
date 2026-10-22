// Design-system entry point (@itrms/ui). Import shared UI from here instead of re-implementing it. It holds no data
// fetching and no business logic (code-structure.md §7): providers and screens live in the app.
export { NotifyProvider, useNotify, useToastRef } from './notify/NotifyProvider';
export { DataGrid } from './data/DataGrid';
export type { DataGridLabels } from './data/DataGrid';
export { confirmAction } from './feedback/confirmAction';
export { InlineStatus } from './feedback/InlineStatus';
export { LabeledField } from './form/LabeledField';
export { KeyValueEditor } from './form/KeyValueEditor';
export { JsonEditor } from './form/JsonEditor';
export { FileViewer } from './files/LazyFileViewer';

// ---- appearance: themes (light, dark, high contrast) and densities; the stylesheet is @itrms/ui/styles.css, tokens as data are @itrms/ui/tokens
export { AppearanceProvider, useAppearance } from './theme/AppearanceProvider';
export type { Appearance, AppearanceProviderProps, ThemePreference } from './theme/AppearanceProvider';
export { AppearanceMenu } from './theme/AppearanceMenu';
export type { AppearanceLabels } from './theme/AppearanceMenu';

// ---- design-system primitives: shadcn/ui on Radix, styled with Tailwind and the semantic tokens (src/styles/tokens.css).
// Features use these instead of primereact/*, @radix-ui/* or PrimeFlex classes (ESLint enforces it in the coded and platform paths).
export * from './primitives/alert';
export * from './primitives/alert-dialog';
export * from './primitives/badge';
export * from './primitives/button';
export * from './primitives/calendar';
export * from './primitives/card';
export * from './primitives/chart';
export * from './primitives/checkbox';
export * from './primitives/collapsible';
export * from './primitives/command';
export * from './primitives/dialog';
export * from './primitives/dropdown-menu';
export * from './primitives/field';
export * from './primitives/input';
export { ETHIOPIC_TOGGLE_KEY, useEthiopicTyping } from './ethiopic/useEthiopicTyping';
export { transliterate } from './ethiopic/transliterate';
export * from './primitives/label';
export * from './primitives/popover';
export * from './primitives/radio-group';
export * from './primitives/select';
export * from './primitives/separator';
export * from './primitives/sheet';
export * from './primitives/sidebar';
export * from './primitives/skeleton';
export * from './primitives/slider';
export * from './primitives/spinner';
export * from './primitives/switch';
export * from './primitives/table';
export * from './primitives/tabs';
export * from './primitives/textarea';
export * from './primitives/toggle';
export * from './primitives/toggle-group';
export * from './primitives/tooltip';
export { cn } from './lib/utils';
export { saveBlob } from './lib/download';

// ---- composite controls on the primitives (pickers, paging, status)
export { Combobox } from './controls/Combobox';
export type { ComboboxOption, ComboboxProps } from './controls/Combobox';
export { DatePicker } from './controls/DatePicker';
export { EthiopianDatePicker } from './controls/EthiopianDatePicker';
export type { EthiopianDatePickerLabels, EthiopianDatePickerProps } from './controls/EthiopianDatePicker';
export type { DatePickerProps } from './controls/DatePicker';
export { TagsInput } from './controls/TagsInput';
export { Pager } from './controls/Pager';
export { IconButton } from './controls/IconButton';
export { StatusBadge, toneOf } from './controls/StatusBadge';
export type { Tone } from './controls/StatusBadge';
export { PersonName, formatPersonName } from './controls/PersonName';
export type { PersonNameForm, PersonNameParts, PersonNameProps } from './controls/PersonName';
export { UnitBadge } from './controls/UnitBadge';
export type { UnitBadgeProps } from './controls/UnitBadge';

// ---- money: santim as bigint, typed and shown as Birr (ADR-0014); never a JS number
export { MoneyInput, MoneyText } from './money/MoneyInput';
export type { MoneyInputProps, MoneyTextProps } from './money/MoneyInput';
export { formatBirr, parseBirr, MAX_BIRR_DIGITS } from './money/money';
export type { ParsedBirr } from './money/money';

// ---- page templates (design-system.md §7): every screen is built from one of these layouts and its parts
export { PageHeader } from './templates/PageHeader';
export type { PageHeaderProps } from './templates/PageHeader';
export { FilterBar } from './templates/FilterBar';
export type { ActiveFilter, FilterBarLabels, FilterBarProps } from './templates/FilterBar';
export { EmptyState } from './templates/EmptyState';
export type { EmptyStateProps } from './templates/EmptyState';
export { DescriptionList } from './templates/DescriptionList';
export type { DescriptionItem, DescriptionListProps } from './templates/DescriptionList';
export { KpiTile } from './templates/KpiTile';
export type { KpiDelta, KpiTileProps } from './templates/KpiTile';
export { WidgetCard } from './templates/WidgetCard';
export type { WidgetCardProps } from './templates/WidgetCard';
export {
    DashboardLayout,
    FormLayout,
    ListLayout,
    RecordLayout,
    SettingRow,
    SettingsLayout,
    SettingsSection
} from './templates/layouts';
export type {
    DashboardLayoutProps,
    FormLayoutProps,
    ListLayoutProps,
    RecordLayoutProps,
    RecordTab,
    SettingRowProps,
    SettingsLayoutProps,
    SettingsSectionProps
} from './templates/layouts';
export { PrintLayout } from './templates/PrintLayout';
export type { PrintLayoutProps } from './templates/PrintLayout';

// ---- hand-written forms: TanStack Form + Zod on the primitives (builder-made forms use the form engine instead)
export { useZodForm, useAppForm, withForm, ZodForm, ServerErrorsProvider } from './forms/formKit';
export type { ServerErrorMapper, ServerFormErrors } from './forms/formKit';
