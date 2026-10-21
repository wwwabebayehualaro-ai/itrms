/**
 * The installed slices, in the platform order of code-structure.md §3. At startup the manifest loader
 * (`@itrms/kernel/api`) checks them against each other and registers the NestJS modules of the enabled ones; a slice
 * without API code yet contributes its manifest only.
 */
import type { DynamicModule, Type } from '@nestjs/common';
import documents from '@itrms/documents/manifest';
import fees from '@itrms/fees/manifest';
import forms from '@itrms/forms/manifest';
import integrations from '@itrms/integrations/manifest';
import kernel from '@itrms/kernel/manifest';
import type { InstalledSlice } from '@itrms/module-sdk';
import reports from '@itrms/reports/manifest';
import services from '@itrms/services/manifest';
import workflow from '@itrms/workflow/manifest';

export type ApiSlice = InstalledSlice<Type | DynamicModule>;

export const SLICES: ApiSlice[] = [kernel, integrations, forms, fees, documents, workflow, services, reports].map(
    (manifest) => ({ manifest })
);
