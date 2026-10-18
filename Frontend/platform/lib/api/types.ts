/**
 * Types of the backend API, generated from the committed contract (contracts/openapi.json -> schema.d.ts by `npm run api:types`).
 * Use these instead of hand-written interfaces so a backend change that breaks the frontend fails `tsc`:
 *
 *   import type { ApiSchema } from '@platform/lib/api/types';
 *   type Flag = ApiSchema<'FeatureFlagOut'>;
 */
import type { components, paths } from './schema';

export type ApiSchemas = components['schemas'];
export type ApiSchema<K extends keyof ApiSchemas> = ApiSchemas[K];
export type ApiPaths = paths;
