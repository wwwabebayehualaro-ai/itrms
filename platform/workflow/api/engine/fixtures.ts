// The driver licence workflow of architecture.md §8, as the engine's tests use it (task 0.19a).
import type { WorkflowDefinition } from '@itrms/schemas';

export const LICENCE: WorkflowDefinition = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start' },
        {
            key: 'review',
            kind: 'task',
            label: { am: 'ሰነድ ማጣራት', en: 'Document review' },
            assignee: { role: 'competency.officer', unit: 'handling' },
            sla: { businessHours: 8 }
        },
        {
            key: 'exam',
            kind: 'task',
            assignee: { role: 'competency.examiner', unit: 'handling' },
            stepForm: 'exam-result@2',
            sla: { businessDays: 10 }
        },
        { key: 'payment', kind: 'task', assignee: { role: 'cashier', unit: 'handling' } },
        {
            key: 'approval',
            kind: 'task',
            assignee: { role: 'competency.lead', unit: '${approval_unit}' },
            separationOfDuties: ['review', 'exam']
        },
        { key: 'national', kind: 'wait', sla: { businessDays: 2 } },
        { key: 'issued', kind: 'end' },
        { key: 'rejected', kind: 'end' }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit' },
        { from: 'review', to: 'exam', action: 'approve' },
        { from: 'review', to: 'draft', action: 'return', commentRequired: true },
        { from: 'exam', to: 'payment', action: 'pass', effects: ['fees.createPaymentOrder'] },
        { from: 'payment', to: 'approval', action: 'paid', guard: { fact: 'payment.settled', op: 'eq', value: true } },
        {
            from: 'approval',
            to: 'national',
            action: 'approve',
            effects: ['competency.createPendingLicence', 'integrations.requestLicence']
        },
        {
            from: 'national',
            to: 'issued',
            on: 'event:national.licence.accepted',
            actor: 'system:national-driver-platform',
            effects: ['competency.activateLicence', 'documents.issue:licence-card']
        },
        {
            from: 'national',
            to: 'approval',
            on: 'event:national.licence.rejected',
            actor: 'system:national-driver-platform',
            effects: ['competency.voidPendingLicence']
        },
        { from: 'national', to: 'approval', on: 'timeout' },
        {
            from: ['review', 'exam', 'payment', 'approval'],
            to: 'rejected',
            action: 'reject',
            rejectRoles: ['competency.officer', 'competency.lead'],
            commentRequired: true
        }
    ]
};

export const KNOWN = {
    roles: new Set(['competency.officer', 'competency.examiner', 'competency.lead', 'cashier']),
    effects: new Set([
        'fees.createPaymentOrder',
        'competency.createPendingLicence',
        'integrations.requestLicence',
        'competency.activateLicence',
        'documents.issue',
        'competency.voidPendingLicence'
    ]),
    stepForms: new Set(['exam-result@2'])
};
