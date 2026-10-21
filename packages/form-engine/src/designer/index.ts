/** @itrms/form-engine/designer: the form builder (design time). Runtime screens import /renderer instead. */

export { FormDesigner as TemplateBuilder, FormDesigner } from './FormDesigner';

// The form opened in the builder: the gallery puts the template, its fields and runtime here before navigating to the builder.
export {
    useFields,
    useTemplate,
    useRuntimeConfig,
    useFormActions as useBuilderActions
} from '../renderer/store/formStore';
