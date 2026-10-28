/**
 * Helpers of the workflow journeys (task 0.20b): the demo accounts they act as, a workflow of their own per run (written
 * by the zone's admin through the API, so the journeys repeat on the same database), and a case started and submitted
 * into its review by Damot Gale's records officer: the setup a journey does not show.
 */
import { randomUUID } from 'node:crypto';

import type { Browser, Page } from '@playwright/test';

import type { Api } from '../forms/support';
import { firstSignIn, resetAccount } from '../keycloak';

export { api } from '../forms/support';

/** Demo accounts of apps/api/seed/users/wolaita.demo.yaml (generated people, never real ones). */
export const PEOPLE = {
    /** Wolaita Zone: writes the zone's workflows (unit_admin) */
    author: { id: '0199f0a0-d000-7000-8000-000000000102', username: 'demo.zone.admin', name: 'Zone Admin (demo)' },
    /** Damot Gale: starts cases and reviews them (records_officer) */
    records: {
        id: '0199f0a0-d000-7000-8000-000000000202',
        username: 'demo.damot.records',
        name: 'Damot Gale Records Officer (demo)'
    },
    /** Damot Gale: approves (unit_head) */
    head: { id: '0199f0a0-d000-7000-8000-000000000201', username: 'demo.damot.head', name: 'Damot Gale Head (demo)' }
} as const;

export type Person = (typeof PEOPLE)[keyof typeof PEOPLE];

/** A browser of its own for one person, signed in through Keycloak (its second factor set up anew). */
export async function signedIn(browser: Browser, who: Person): Promise<Page> {
    await resetAccount(who.id);
    const page = await (await browser.newContext()).newPage();
    await firstSignIn(page, who.username);
    return page;
}

/** A review by the records officer, then the office head's approval. */
const DEFINITION = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: { am: 'ረቂቅ', en: 'Draft' } },
        {
            key: 'review',
            kind: 'task',
            label: { am: 'ማጣራት', en: 'Review' },
            assignee: { role: 'records_officer', unit: 'handling' },
            sla: { businessHours: 8 }
        },
        {
            key: 'approval',
            kind: 'task',
            label: { am: 'ማጽደቅ', en: 'Approval' },
            assignee: { role: 'unit_head', unit: 'handling' }
        },
        { key: 'done', kind: 'end', label: { am: 'ተጠናቋል', en: 'Done' } }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit' },
        { from: 'review', to: 'approval', action: 'forward', label: { am: 'አስተላልፍ', en: 'Forward' } },
        { from: 'approval', to: 'done', action: 'approve', label: { am: 'አጽድቅ', en: 'Approve' } }
    ]
};

/** The run's workflow, by the zone's admin; its id. */
export async function journeyWorkflow(author: Api, name: string): Promise<string> {
    const made = await author.post<{ id: string }>('v1/workflow-definitions', {
        key: `e2e-${name}-${randomUUID().slice(0, 6)}`,
        name: { am: `የሙከራ ሂደት ${name}`, en: `Journey ${name}` },
        definition: DEFINITION
    });
    return made.id;
}

export interface Started {
    id: string;
    number: number;
}

/** A case started at Damot Gale and submitted into its review. */
export async function submittedCase(records: Api, workflowId: string): Promise<Started> {
    const c = await records.post<{ id: string; number: number; version: number }>('v1/cases', { workflowId });
    await records.post(`v1/cases/${c.id}/transitions`, { action: 'submit' }, c.version);
    return { id: c.id, number: c.number };
}
