/** @platform/form-engine/builder - PUBLIC API (design-time side): the form builder. */

export { FormDesigner as TemplateBuilder, FormDesigner } from './designer/FormDesigner';

// The form opened in the builder: the gallery puts the template, its fields and runtime here before navigating to the builder.
export { useFields, useTemplate, useRuntimeConfig, useFormActions as useBuilderActions } from './store/formStore';
