import { defineModule } from '@itrms/module-sdk';

// Document templates, the documents issued and their PDFs (architecture.md §10, ADR-0006, ADR-0044; task 0.23a). The kernel
// grants `issued-document:read` to its roles. A unit's header is inherited down the tree.
export default defineModule({
    key: 'documents',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel', 'forms', 'fees'],
    title: { am: 'ሰነዶች', en: 'Documents' },
    permissions: {
        'issued-document': ['read']
    },
    // a case's document of a template (`documents.issue:application-copy`)
    effects: ['documents.issue'],
    events: {
        emits: ['document.render.v1'],
        // a receipt's document, revoked when it is reversed; a document's PDF (in the worker-documents process)
        consumes: ['receipt.issued.v1', 'receipt.reversed.v1', 'document.render.v1']
    },
    settings: [
        {
            key: 'documents.header',
            default: {},
            overridableAt: ['installation', 'region', 'unitType', 'unit']
        }
    ]
});
