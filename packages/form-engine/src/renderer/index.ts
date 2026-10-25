/**
 * @itrms/form-engine/renderer: fill in and show forms. Screens import from here (and /designer, /viewer), never deeper.
 *
 *   import { FormsHostProvider, FormRenderer, defineFieldType, registerAction } from '@itrms/form-engine/renderer';
 *
 * The builder is in /designer so runtime-only screens do not ship it; the data viewer is in /viewer.
 */

// ---- what the app provides: its HTTP client, the signed-in person, the location -------------------------
export {
    FormsHostProvider,
    useFormsHost,
    useFormsClient,
    useFormsUser,
    useCan,
    useFormsLanguages
} from '../host/FormsHost';
export type { FormsHost, FormsUser, FormsLocation } from '../host/FormsHost';
export { isRequestError, requestErrorMessage, serverFormErrors } from '../host/client';
export type {
    FormsClient,
    FormsRequest,
    FormsRequestOptions,
    FormsResponse,
    FormsRequestError,
    ServerFormErrors
} from '../host/client';

// ---- render a saved template as a working form ------------------------------------------------------
export { default as FormRenderer } from './FormRenderer';
// fill in a form: the published version, never the builder's working copy
export { PublishedFormRenderer } from './PublishedFormRenderer';
export { TemplateStatusTag } from './TemplateStatusTag';

// ---- backend access ---------------------------------------------------------------------------------
export {
    useTemplateList,
    useVisibleTemplates,
    isViewTemplate,
    useTemplateQuery,
    useTemplateMutations,
    useTemplateLoader,
    usePublishedTemplate,
    templateKeys
} from '../api/templates';
export type { TemplateInput, PublishedForm } from '../api/templates';
export {
    useCanChangeRequests,
    useSubmissionList,
    useSubmissionQuery,
    useSubmissionMutations,
    submissionKeys,
    type ScreenSubmission,
    type SubmissionListPage,
    type SubmissionListParams
} from '../api/submissions';
export { usePreview as useAttachmentPreview } from '../api/usePreview';

// ---- extension points -------------------------------------------------------------------------------
export { registerAction } from './extensions';
export type { ActionContext, ActionHandler } from './extensions';
// field types: how a type renders (`defineFieldType`) and how the builder offers it (`describeFieldType`)
export { defineFieldType, describeFieldType, PALETTE_GROUPS } from './kit';
export type {
    FieldTypeDef,
    ValueFieldProps,
    ContainerFieldProps,
    DisplayFieldProps,
    DesignMeta,
    PaletteGroup
} from './kit';

// ---- template model (what is persisted in form_config) ----------------------------------------------
export type { FormField, Action, VisibilityCondition } from '@itrms/schemas';
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
} from '@itrms/schemas';
export { EMPTY_RUNTIME, getRuntimeConfig } from '@itrms/schemas';

// ---- data binding (safe: no code evaluation) --------------------------------------------------------
export { resolveBindings, resolveString, getByPath } from '../core/runtime/expression';

// ---- data tables: rows from a data source, row buttons reported as a window event --------------------
export { ROW_ACTION_EVENT } from './runtime/rowActions';
export type { RowActionDetail } from './runtime/rowActions';
export type { FieldRowsBinding, TableColumn, ColumnType } from '@itrms/schemas';

// ---- state of the template in use -------------------------------------------------------------------
export { useTemplate } from './store/formStore';
