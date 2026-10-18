// Design-system entry point. Import shared UI from '.' instead of re-implementing it.
export { NotifyProvider, useNotify, useToastRef } from './notify/NotifyProvider';
export { QueryProvider, createQueryClient, shouldRetry } from './query/QueryProvider';
export { DataGrid } from './data/DataGrid';
export { confirmAction } from './feedback/confirmAction';
export { InlineStatus } from './feedback/InlineStatus';
export { LabeledField } from './form/LabeledField';
export { KeyValueEditor } from './form/KeyValueEditor';
export { JsonEditor } from './form/JsonEditor';
export { AuthGate } from './auth/AuthGate';
export { FileViewer } from './files/LazyFileViewer';

// ---- design-system primitives: shadcn/ui on Radix, styled with Tailwind (tokens in app/globals.css).
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

// ---- composite controls on the primitives (pickers, paging, status)
export { Combobox } from './controls/Combobox';
export type { ComboboxOption, ComboboxProps } from './controls/Combobox';
export { DatePicker } from './controls/DatePicker';
export type { DatePickerProps } from './controls/DatePicker';
export { TagsInput } from './controls/TagsInput';
export { Pager } from './controls/Pager';
export { IconButton } from './controls/IconButton';
export { StatusBadge, toneOf } from './controls/StatusBadge';
export type { Tone } from './controls/StatusBadge';

// ---- hand-written forms: TanStack Form + Zod on the primitives (builder-made forms use the form engine instead)
export { useZodForm, useAppForm, withForm, ZodForm } from './forms/formKit';

// ---- platform screens and gates (mounted by thin pages in app/(main)/(platform))
export { FeatureGate } from './screens/FeatureGate';
export { FeatureFlagsAdmin } from './screens/FeatureFlagsAdmin';
export { ApprovalInbox } from './screens/ApprovalInbox';
export { ApprovalStatusTag } from './screens/ApprovalStatusTag';
export { SequencesAdmin } from './screens/SequencesAdmin';
