/**
 * Shared primitives and contracts (ADR-0032): imported by the API, the web app and every slice. Imports nothing internal.
 *
 * - problem+json: reading API error bodies.
 * - Forms: the stored form (`form_config`) as types and Zod schemas, the backend contract, and the forms API's DTOs.
 */
export * from './forms/conditions';
export * from './forms/runtime';
export * from './forms/stored';
export * from './forms/schema';
export * from './forms/contract';
export * from './forms/dto';
export * from './problem';
