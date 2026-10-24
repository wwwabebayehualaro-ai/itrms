import { defineModule } from '@itrms/module-sdk';

// Form definitions, versions and submissions (form-platform.md, task 0.16a). The cross-cutting roles get these permissions
// in the kernel's manifest (only the kernel defines them). Publishing is maker-checker (SEC-AC-6): one person asks with
// `form:publish`, another with `form:approve` decides.
export default defineModule({
    key: 'forms',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel'],
    title: { am: 'ቅጾች', en: 'Forms' },
    permissions: {
        form: ['read', 'create', 'update', 'publish', 'approve'],
        submission: ['read', 'create', 'update']
    },
    // the worker fills the values of newly filterable fields when a version is published (ADR-0035)
    events: { emits: ['form.published.v1'], consumes: ['form.published.v1'] }
});
