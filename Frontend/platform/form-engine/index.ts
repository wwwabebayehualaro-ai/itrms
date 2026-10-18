/**
 * @platform/form-engine - PUBLIC API (renderer side). Feature code imports from here and nowhere deeper.
 *
 *   import { FormRenderer, defineFieldType, registerAction, useSubmissionMutations } from '@platform/form-engine';
 *
 * The form builder is in '@platform/form-engine/builder' so runtime-only screens do not ship it.
 */

// ---- render a saved template as a working form ------------------------------------------------------
export { default as FormRenderer } from './FormRenderer';
// fill in a form: the published version, never the builder's working copy
export { PublishedFormRenderer } from './PublishedFormRenderer';
export { TemplateStatusTag } from './TemplateStatusTag';

// ---- backend access ---------------------------------------------------------------------------------
export { useTemplateList, useVisibleTemplates, isViewTemplate, useTemplateQuery, useTemplateMutations, usePublishedTemplate, templateKeys } from './api/templates';
export type { TemplateInput, PublishedForm } from './api/templates';
export { useSubmissionList, useSubmissionQuery, useSubmissionMutations, submissionKeys } from './api/submissions';
export type { SubmissionListParams } from './api/submissions';
export { usePreview as useAttachmentPreview } from './api/usePreview';

// ---- data viewer: the submitted data of any form as table / cards / board / calendar / pivot / dashboard ----
export { DataViewer, registerViewMode, useViewSchema, useSubmissionData, useRecordForm, useRecordHistory, useLabeler, StatusTag, STATUSES, titleOf } from './viewer';
export type { RecordForm, HistoryEntry, FieldChange } from './viewer';
export type { DataViewerProps, ViewMode, ViewModeProps, ViewSchema, ViewField, QueryRequest, QueryResult, ViewRow, ViewState } from './viewer';

// ---- extension points -------------------------------------------------------------------------------
export { registerAction } from './extensions';
export type { ActionContext, ActionHandler } from './extensions';
// field types: how a type renders (`defineFieldType`) and how the builder offers it (`describeFieldType`)
export { defineFieldType, describeFieldType, PALETTE_GROUPS } from './renderer/kit';
export type { FieldTypeDef, ValueFieldProps, ContainerFieldProps, DisplayFieldProps, DesignMeta, PaletteGroup } from './renderer/kit';

// ---- template model (what is persisted in form_config) ----------------------------------------------
export type { FormField, Action, VisibilityCondition } from './core/storedTypes';
export type {
    TemplateRuntimeConfig,
    DataSourceDefinition,
    RuntimeContext,
    RuntimeVariable,
    SubmitConfig,
    FieldOptionsBinding,
    OptionMapping,
    ResponseMapping,
    ErrorMapping,
    HttpMethod
} from './Runtime/types';
export { EMPTY_RUNTIME, getRuntimeConfig } from './Runtime/types';

// ---- data binding (safe: no code evaluation) --------------------------------------------------------
export { resolveBindings, resolveString, getByPath } from './Runtime/expression';

// ---- data tables: rows from a data source, row buttons reported as a window event --------------------
export { ROW_ACTION_EVENT } from './Runtime/rowActions';
export type { RowActionDetail } from './Runtime/rowActions';
export type { FieldRowsBinding, TableColumn, ColumnType } from './Runtime/types';

// ---- state of the template in use -------------------------------------------------------------------
export { useTemplate } from './store/formStore';
