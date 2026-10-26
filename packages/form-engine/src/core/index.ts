/**
 * Form engine core: the document model, rules, values and validation, with no UI. Renderers (the runtime form, the builder
 * canvas) and the backend contract build on this; it also runs in the API, so it imports no React and no DOM (lint and dependency-cruiser enforce it).
 */
export { SCHEMA_VERSION, storedFieldSchema, formDocumentSchema } from '@itrms/schemas';
export type { StoredField } from '@itrms/schemas';
export {
    readDocument,
    toEngineField,
    DEFAULT_TEXT_LANGUAGE,
    containerTitle,
    childrenOf,
    isFormArray,
    isRequiredIn,
    rowScopedIds
} from './model';
export { evalCondition, checkRuleFormula } from './runtime/formula';
export { valueKindOf, shapeError, type ValueKind } from './kinds';
export { ethiopianDateText, isIsoDay, addisDayTime } from './dates';
export { numberFormatOf } from './format';
export { printModel, printValueText, PRINT_WORDS } from './print';
export type { PrintDocument, PrintNode, PrintOptions, PrintWords } from './print';
export { untranslatedTexts, untranslatedInDocument, type UntranslatedText } from './text';
export {
    fieldTexts,
    formTextIn,
    missingIn,
    ownText,
    setTextIn,
    REQUIRED_TEXT_LANGUAGES,
    TEXT_PROPS,
    textLanguageOf,
    textPropsOf,
    type FieldText,
    type FormText
} from '@itrms/schemas';
export type { EngineDocument, EngineField, FieldOption, FieldRules } from './model';
export { evaluateAll, conditionReferences } from './conditions';
export type { Scope } from './conditions';
export {
    initialValues,
    initialValueOf,
    emptyRow,
    pruneHidden,
    knownValues,
    settledValues,
    submittedValues,
    scopeFields,
    holdsValue,
    isListField,
    isVisibleIn,
    isEnabledIn
} from './values';
export { validateForm, fieldSchema, parseDate, REMOTE_PENDING } from './validate';
export type { FieldErrors } from './validate';
export { checkDocument, MAX_PROBLEMS } from './document';
export type { DocumentProblem } from './document';
export { FIELD_TYPES } from './fieldTypes';
