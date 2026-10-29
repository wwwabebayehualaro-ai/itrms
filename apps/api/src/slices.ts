/**
 * The installed slices, in the platform order of code-structure.md §3. At startup the manifest loader
 * (`@itrms/kernel/api`) checks them against each other and registers the NestJS modules of the enabled ones; a slice
 * without API code yet contributes its manifest only.
 */
import type { DynamicModule, Type } from '@nestjs/common';
import competency from '@itrms/competency/manifest';
import competencyAm from '@itrms/competency/messages/am';
import competencyEn from '@itrms/competency/messages/en';
import competencyWal from '@itrms/competency/messages/wal-Latn';
import documents from '@itrms/documents/manifest';
import fees from '@itrms/fees/manifest';
import { FormsModule } from '@itrms/forms/api';
import { FORMS_EVENTS, FORMS_SETTINGS } from '@itrms/forms/contracts';
import forms from '@itrms/forms/manifest';
import formsAm from '@itrms/forms/messages/am';
import formsEn from '@itrms/forms/messages/en';
import formsWal from '@itrms/forms/messages/wal-Latn';
import integrations from '@itrms/integrations/manifest';
import { KERNEL_EVENTS, KERNEL_SETTINGS } from '@itrms/kernel/contracts';
import kernel from '@itrms/kernel/manifest';
import kernelAm from '@itrms/kernel/messages/am';
import kernelEn from '@itrms/kernel/messages/en';
import kernelWal from '@itrms/kernel/messages/wal-Latn';
import { PartiesModule } from '@itrms/parties/api';
import { PARTIES_EVENTS } from '@itrms/parties/contracts';
import parties from '@itrms/parties/manifest';
import partiesAm from '@itrms/parties/messages/am';
import partiesEn from '@itrms/parties/messages/en';
import partiesWal from '@itrms/parties/messages/wal-Latn';
import type { InstalledSlice } from '@itrms/module-sdk';
import reports from '@itrms/reports/manifest';
import { ServicesModule } from '@itrms/services/api';
import services from '@itrms/services/manifest';
import servicesAm from '@itrms/services/messages/am';
import servicesEn from '@itrms/services/messages/en';
import servicesWal from '@itrms/services/messages/wal-Latn';
import { WorkflowModule } from '@itrms/workflow/api';
import { WORKFLOW_EVENTS } from '@itrms/workflow/contracts';
import workflow from '@itrms/workflow/manifest';
import workflowAm from '@itrms/workflow/messages/am';
import workflowEn from '@itrms/workflow/messages/en';
import workflowWal from '@itrms/workflow/messages/wal-Latn';

export type ApiSlice = InstalledSlice<Type | DynamicModule>;

export const SLICES: ApiSlice[] = [
    {
        manifest: kernel,
        events: KERNEL_EVENTS,
        settings: KERNEL_SETTINGS,
        messages: { am: kernelAm, en: kernelEn, 'wal-Latn': kernelWal }
    },
    { manifest: integrations },
    {
        manifest: forms,
        module: FormsModule,
        events: FORMS_EVENTS,
        settings: FORMS_SETTINGS,
        // its menu entry and its notices (an export ready) are read in the person's language (tasks 0.20b, 0.20d)
        messages: { am: formsAm, en: formsEn, 'wal-Latn': formsWal }
    },
    ...[fees, documents].map((manifest) => ({ manifest })),
    {
        manifest: workflow,
        module: WorkflowModule,
        events: WORKFLOW_EVENTS,
        messages: { am: workflowAm, en: workflowEn, 'wal-Latn': workflowWal }
    },
    {
        manifest: services,
        module: ServicesModule,
        messages: { am: servicesAm, en: servicesEn, 'wal-Latn': servicesWal }
    },
    { manifest: reports },
    {
        manifest: parties,
        module: PartiesModule,
        events: PARTIES_EVENTS,
        messages: { am: partiesAm, en: partiesEn, 'wal-Latn': partiesWal }
    },
    { manifest: competency, messages: { am: competencyAm, en: competencyEn, 'wal-Latn': competencyWal } }
];
