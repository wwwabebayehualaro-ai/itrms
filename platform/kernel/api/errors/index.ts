/**
 * @itrms/kernel/errors: every failure the API reports is an AppError subclass with a stable snake_case `code` and an i18n
 * `title` key (api-guidelines.md §4). The problem+json filter turns them, and anything else, into RFC 9457 bodies; an error
 * that is not an AppError is a 500 that never shows its internals.
 */
export * from './app-error';
export { ProblemFilter, problemOf, type Problem } from './problem.filter';
