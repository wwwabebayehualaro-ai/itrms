// Layer and boundary rules (docs/platform/code-structure.md §3, ADR-0032). Run: pnpm boundaries.
// Paths are matched on resolved files relative to the repository root, so a workspace import such as
// `@itrms/kernel/db` is checked as `platform/kernel/api/db/index.ts`. Each rule has a failing fixture in
// tools/boundaries/fixtures/, exercised by tools/boundaries/boundaries.test.mjs.
const { PLATFORM_ORDER, REGISTRIES } = require('./tools/boundaries/layers.cjs');

const REG = REGISTRIES.join('|');
const SYSTEM_POOL = '^platform/kernel/api/db/system\\.ts$';

/** Files of a slice that other packages may resolve to (its package exports). */
const PUBLIC_ENTRY =
    '^(platform|modules)/[^/]+/(module\\.ts|contracts/index\\.ts|api/(index|worker)\\.ts|web/(server|client)\\.ts|messages/[^/]+\\.json|seed/index\\.ts)$';
const KERNEL_SUBPATH = '^platform/kernel/api/[^/]+/index\\.ts$|^platform/kernel/api/db/system\\.ts$';

/** Code that runs only in the worker processes: the worker entry of a slice, its jobs and handlers, and the app's worker entries. */
const WORKER_CODE = [
    '^(platform|modules)/[^/]+/api/(jobs|handlers)/',
    '^(platform|modules)/[^/]+/api/worker\\.ts$',
    '^apps/api/src/worker(-documents)?\\.ts$'
];

const platformOrderRules = PLATFORM_ORDER.slice(0, -1).map((service, i) => ({
    name: `platform-order-${service}`,
    comment: `platform/${service} may import only the platform slices before it (${PLATFORM_ORDER.slice(0, i).join(', ') || 'none'}).`,
    severity: 'error',
    from: { path: `^platform/${service}/` },
    to: { path: `^platform/(${PLATFORM_ORDER.slice(i + 1).join('|')})/` }
}));

module.exports = {
    forbidden: [
        {
            name: 'no-circular',
            comment: 'Import cycles hide layering mistakes and break incremental builds.',
            severity: 'error',
            from: {},
            to: { circular: true }
        },
        {
            name: 'no-unresolved-internal',
            comment:
                'An @itrms/* or #… import that does not resolve would slip past every path rule: declare the dependency and use a package export.',
            severity: 'error',
            from: {},
            to: { couldNotResolve: true, path: '^(@itrms/|#)' }
        },
        {
            name: 'no-importing-apps',
            comment: 'Apps are composition roots: nothing imports an app.',
            severity: 'error',
            from: { path: '^(platform|modules|packages)/' },
            to: { path: '^apps/' }
        },
        {
            name: 'no-app-to-app',
            comment: 'An app never imports another app.',
            severity: 'error',
            from: { path: '^apps/([^/]+)/' },
            to: { path: '^apps/', pathNot: '^apps/$1/' }
        },
        {
            name: 'leaf-packages-import-nothing-internal',
            comment: 'schemas and ethiopian-calendar import nothing internal.',
            severity: 'error',
            from: { path: '^packages/(schemas|ethiopian-calendar)/' },
            to: { path: '^(apps|platform|modules|packages)/', pathNot: '^packages/$1/' }
        },
        {
            name: 'form-engine-core-is-ui-free',
            comment: 'form-engine/core runs in the API: only schemas, ethiopian-calendar and itself; no React or DOM.',
            severity: 'error',
            from: { path: '^packages/form-engine/src/core/' },
            to: {
                path: '^(apps|platform|modules|packages)/|(^|/)node_modules/(react|react-dom|@radix-ui)/|^(react|react-dom)($|/)',
                pathNot: '^packages/(schemas|ethiopian-calendar)/|^packages/form-engine/src/core/'
            }
        },
        {
            name: 'ui-packages-stay-below-runtime',
            comment: 'ui and form-engine import only schemas, ethiopian-calendar, ui and form-engine.',
            severity: 'error',
            from: { path: '^packages/(ui|form-engine)/' },
            to: {
                path: '^(apps|platform|modules|packages)/',
                pathNot: '^packages/(schemas|ethiopian-calendar|ui|form-engine)/'
            }
        },
        {
            name: 'tool-packages-import-schemas-only',
            comment: 'module-sdk, api-client, testing and config import only schemas and themselves.',
            severity: 'error',
            from: { path: '^packages/(module-sdk|api-client|testing|config)/' },
            to: { path: '^(apps|platform|modules|packages)/', pathNot: ['^packages/schemas/', '^packages/$1/'] }
        },
        {
            name: 'kernel-imports-only-packages',
            comment: 'The kernel imports no other platform slice and no module.',
            severity: 'error',
            from: { path: '^platform/kernel/' },
            to: { path: '^platform/(?!kernel/)|^modules/' }
        },
        ...platformOrderRules,
        {
            name: 'platform-never-imports-modules',
            comment: 'Platform slices know nothing about the business modules.',
            severity: 'error',
            from: { path: '^platform/' },
            to: { path: '^modules/' }
        },
        {
            name: 'registry-never-imports-work-process',
            comment: 'Registries sit below the work processes.',
            severity: 'error',
            from: { path: `^modules/(${REG})/` },
            to: { path: '^modules/', pathNot: `^modules/(${REG})/` }
        },
        {
            name: 'no-work-process-to-work-process',
            comment: 'Work-process modules never import each other: use events or a registry.',
            severity: 'error',
            from: { path: '^modules/([^/]+)/', pathNot: `^modules/(${REG})/` },
            to: { path: '^modules/', pathNot: [`^modules/$1/`, `^modules/(${REG})/`] }
        },
        {
            name: 'only-public-entries-of-other-slices',
            comment: 'Other slices are reached only through their package exports, never their internals.',
            severity: 'error',
            from: { path: '^(platform|modules)/([^/]+)/' },
            to: { path: '^(platform|modules)/[^/]+/', pathNot: ['^$1/$2/', PUBLIC_ENTRY, KERNEL_SUBPATH] }
        },
        {
            name: 'apps-use-public-entries',
            comment: 'Apps reach slices only through their package exports.',
            severity: 'error',
            from: { path: '^apps/' },
            to: { path: '^(platform|modules)/[^/]+/', pathNot: [PUBLIC_ENTRY, KERNEL_SUBPATH] }
        },
        {
            name: 'contracts-are-isomorphic',
            comment:
                'contracts/ imports only schemas, its own contracts and other slices’ public contracts; never NestJS, React or Next.js.',
            severity: 'error',
            // An allow-list for workspace code plus a deny-list for the npm frameworks that must never reach the browser.
            from: { path: '^(platform|modules)/([^/]+)/contracts/' },
            to: {
                path: '^(apps|platform|modules|packages)/|(^|/)node_modules/(@nestjs|react|react-dom|next)/|^(@nestjs/|react($|/)|react-dom|next/)',
                pathNot: ['^packages/schemas/', '^$1/$2/contracts/', '^(platform|modules)/[^/]+/contracts/index\\.ts$']
            }
        },
        {
            name: 'contracts-no-node-builtins',
            comment: 'contracts/ runs in the browser too.',
            severity: 'error',
            from: { path: '^(platform|modules)/[^/]+/contracts/' },
            to: { dependencyTypes: ['core'] }
        },
        {
            name: 'web-never-imports-api',
            comment: 'Browser and Server Component code never pulls in server-only API code.',
            severity: 'error',
            from: { path: '^(platform|modules)/[^/]+/web/|^apps/(web|verify)/' },
            to: { path: '^(platform|modules)/[^/]+/api/|(^|/)node_modules/@nestjs/|^@nestjs/' }
        },
        {
            name: 'api-never-imports-ui',
            comment: 'API code never imports the design system, form-engine UI entries or any web entry.',
            severity: 'error',
            from: { path: '^apps/api/|^(platform|modules)/[^/]+/api/' },
            to: {
                path: '^packages/ui/|^packages/form-engine/src/(renderer|designer|viewer)/|^(platform|modules)/[^/]+/web/'
            }
        },
        {
            name: 'system-pool-only-in-worker-code',
            comment:
                'The itrms_system pool (BYPASSRLS) is imported only by jobs, event handlers and the worker entries (architecture §5).',
            severity: 'error',
            from: { pathNot: WORKER_CODE },
            to: { path: SYSTEM_POOL }
        },
        {
            name: 'http-entries-never-reach-system-pool',
            comment:
                'No import path, however indirect (re-exports included), leads from the HTTP process or a slice’s api entry to the system pool.',
            severity: 'error',
            from: {
                path: '^apps/api/src/main\\.ts$|^(platform|modules)/[^/]+/api/index\\.ts$|^platform/kernel/api/[^/]+/index\\.ts$',
                pathNot: WORKER_CODE
            },
            to: { path: SYSTEM_POOL, reachable: true }
        },
        {
            name: 'worker-code-only-from-worker-entries',
            comment: 'jobs/ and handlers/ are registered by the slice’s api/worker.ts, never by its HTTP side.',
            severity: 'error',
            from: { pathNot: WORKER_CODE },
            to: { path: '^(platform|modules)/[^/]+/api/(jobs|handlers)/' }
        },
        {
            name: 'verify-app-allow-list',
            comment:
                'The public verify app may use only ui, schemas, ethiopian-calendar, api-client and documents/contracts.',
            severity: 'error',
            from: { path: '^apps/verify/' },
            to: {
                path: '^(platform|modules|packages)/',
                pathNot: ['^packages/(ui|schemas|ethiopian-calendar|api-client)/', '^platform/documents/contracts/']
            }
        }
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        // Per-package tool config files import the shared presets; they are not product code. Anchored to package roots.
        exclude: {
            path: [
                '(^|/)(node_modules|dist|\\.turbo|coverage)/',
                '^modules/_template/',
                '^(apps|platform|modules|packages)/[^/]+/(eslint|vitest)\\.config\\.(js|ts)$'
            ]
        },
        // The web app's @/* alias (Next.js convention) is resolved through its tsconfig.
        tsConfig: { fileName: require('node:path').join(__dirname, 'tsconfig.depcruise.json') },
        tsPreCompilationDeps: true,
        combinedDependencies: true,
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default', 'types'],
            mainFields: ['module', 'main', 'types'],
            extensions: ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.cjs', '.json']
        },
        reporterOptions: { text: { highlightFocused: true } }
    }
};
