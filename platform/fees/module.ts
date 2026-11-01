import { defineModule } from '@itrms/module-sdk';

// Fee rules and the fees cases keep (architecture.md §9, ADR-0041; task 0.22a). The bureau writes a rule's versions at
// the region's root (`fee-rule:create`); another person approves each before a service version may charge by it
// (`fee-rule:approve`, SEC-AC-6), in a role the region's setting names. The kernel grants these to its roles.
export default defineModule({
    key: 'fees',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel', 'forms'],
    title: { am: 'ክፍያዎች', en: 'Fees' },
    permissions: {
        'fee-rule': ['read', 'create', 'approve']
    },
    // a corrected request's fee worked out again (named on the workflow's amending transitions)
    effects: ['fees.assess'],
    // the roles that may approve a fee rule version (schemas: FEES_SETTINGS): by Ethiopian practice the bureau's
    // administrator or its finance officer, never the version's author (product owner, 2026-11-01)
    settings: [
        {
            key: 'fees.rules.approverRoles',
            default: ['bureau_admin', 'finance_officer'],
            overridableAt: ['installation', 'region']
        }
    ]
});
