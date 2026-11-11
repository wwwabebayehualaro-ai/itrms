import { defineModule } from '@itrms/module-sdk';

// Fee rules and the fees cases keep (architecture.md §9, ADR-0041; task 0.22a). The bureau writes a rule's versions at
// the region's root (`fee-rule:create`); another person approves each before a service version may charge by it
// (`fee-rule:approve`, SEC-AC-6), in a role the region's setting names. The kernel grants these to its roles.
// Payment orders, the cashier's payments and receipts, and their reversals (task 0.22b, ADR-0042): the cashier records a
// payment at the till of the case's office; another person decides a reversal.
export default defineModule({
    key: 'fees',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel', 'forms'],
    title: { am: 'ክፍያዎች', en: 'Fees' },
    permissions: {
        'fee-rule': ['read', 'create', 'approve'],
        'payment-order': ['read'],
        payment: ['read', 'record'],
        receipt: ['read'],
        'receipt-reversal': ['read', 'request', 'decide'],
        // money paid elsewhere (task 0.22c, ADR-0043): the counter enters a reference, another person verifies it, or a
        // statement's line does
        'external-payment': ['read', 'enter', 'verify'],
        'external-statement': ['read', 'import'],
        // controlled stationery (task 1.12a, ADR-0050): a keeper receives, hands down, accepts and writes off; an office
        // closes its count; using an item has no permission of its own (the printing or issuing command's)
        stationery: ['read', 'receive', 'allocate', 'write-off', 'close']
    },
    // a corrected request's fee worked out again (named on the workflow's amending transitions); a case's fee as a
    // payment order (named on the transition into its payment step)
    effects: ['fees.assess', 'fees.createPaymentOrder'],
    // ITRMS's receipt numbers (the counter `fees.receipt`): gapless per office and fiscal year (ADR-0014)
    numberSequences: [{ key: 'receipt', pattern: '{unit}/{seq:06}/{efy}' }],
    events: {
        emits: [
            'payment.settled.v1',
            'receipt.issued.v1',
            'receipt.reversed.v1',
            'external-payment.entered.v1',
            'external-statement.received.v1'
        ],
        // a closed case's open order is cancelled; a reference and a statement are matched
        consumes: ['case.transitioned.v1', 'external-payment.entered.v1', 'external-statement.received.v1']
    },
    // the roles that may approve a fee rule version (schemas: FEES_SETTINGS): by Ethiopian practice the bureau's
    // administrator or its finance officer, never the version's author (product owner, 2026-11-01); where an office's
    // receipt numbers come from (ITRMS by default, or a pre-printed pad); who decides a reversal (the finance officer by
    // default, never the person who asked nor the cashier who took the money); the banks a deposit slip may be of
    settings: [
        {
            key: 'fees.rules.approverRoles',
            default: ['bureau_admin', 'finance_officer'],
            overridableAt: ['installation', 'region']
        },
        {
            key: 'fees.receipts.source',
            default: 'itrms',
            overridableAt: ['installation', 'region', 'unitType', 'unit']
        },
        {
            key: 'fees.reversals.approverRoles',
            default: ['finance_officer'],
            overridableAt: ['installation', 'region']
        },
        {
            key: 'fees.payments.banks',
            default: [
                { code: 'CBE', name: { am: 'የኢትዮጵያ ንግድ ባንክ', en: 'Commercial Bank of Ethiopia' } },
                { code: 'AWASH', name: { am: 'አዋሽ ባንክ', en: 'Awash Bank' } },
                { code: 'DASHEN', name: { am: 'ዳሽን ባንክ', en: 'Dashen Bank' } },
                { code: 'ABYSSINIA', name: { am: 'አቢሲኒያ ባንክ', en: 'Bank of Abyssinia' } },
                { code: 'OROMIA', name: { am: 'ኦሮሚያ ባንክ', en: 'Oromia Bank' } },
                { code: 'COOP', name: { am: 'የኦሮሚያ ኅብረት ሥራ ባንክ', en: 'Cooperative Bank of Oromia' } },
                { code: 'WEGAGEN', name: { am: 'ወጋገን ባንክ', en: 'Wegagen Bank' } },
                { code: 'HIBRET', name: { am: 'ኅብረት ባንክ', en: 'Hibret Bank' } }
            ],
            overridableAt: ['installation', 'region']
        },
        // who verifies a reference paid elsewhere (never who entered it), and who may issue one. By Ethiopian practice a
        // revenue office and the state's commercial bank; a region lists its own (assumption, ADR-0043)
        {
            key: 'fees.external.verifierRoles',
            default: ['finance_officer'],
            overridableAt: ['installation', 'region']
        },
        {
            key: 'fees.external.issuers',
            default: [
                {
                    code: 'REVENUE',
                    kind: 'revenue_office',
                    name: { am: 'የገቢዎች ጽ/ቤት', en: 'Revenue office' }
                },
                {
                    code: 'CBE',
                    kind: 'bank',
                    name: { am: 'የኢትዮጵያ ንግድ ባንክ', en: 'Commercial Bank of Ethiopia' }
                }
            ],
            overridableAt: ['installation', 'region']
        }
    ],
    // the cashier's queue at an office with a till; the reversals waiting for a decision; orders paid elsewhere, the
    // references to verify, and the statements
    menu: [
        {
            key: 'fees.cashier',
            group: 'my-work',
            order: 30,
            label: 'fees.nav.cashier',
            icon: 'banknote',
            route: '/cashier',
            requires: { permission: 'payment:record', capabilities: ['collects_cash'] }
        },
        {
            key: 'fees.reversals',
            group: 'my-work',
            order: 40,
            label: 'fees.nav.reversals',
            icon: 'undo-2',
            route: '/finance/reversals',
            requires: { permission: 'receipt-reversal:decide' }
        },
        {
            key: 'fees.elsewhere',
            group: 'my-work',
            order: 35,
            label: 'fees.nav.elsewhere',
            icon: 'landmark',
            route: '/paid-elsewhere',
            requires: { permission: 'external-payment:enter' }
        },
        {
            key: 'fees.externalRefs',
            group: 'my-work',
            order: 45,
            label: 'fees.nav.externalRefs',
            icon: 'badge-check',
            route: '/finance/external-payments',
            requires: { permission: 'external-payment:verify' }
        },
        {
            key: 'fees.statements',
            group: 'my-work',
            order: 46,
            label: 'fees.nav.statements',
            icon: 'file-spreadsheet',
            route: '/finance/statements',
            requires: { permission: 'external-statement:import' }
        },
        {
            key: 'fees.stationery',
            group: 'registries',
            order: 17,
            label: 'fees.nav.stationery',
            icon: 'scroll-text',
            route: '/registry/stationery',
            requires: { permission: 'stationery:read', capabilities: ['holds_stationery'] }
        }
    ]
});
