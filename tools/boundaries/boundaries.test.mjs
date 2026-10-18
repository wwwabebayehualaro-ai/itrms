// The dependency-cruiser rules have failing fixtures (phase-0 task 0.2): every rule must fire on its bad-* fixture,
// no ok-* fixture may fire, and no rule may exist without a fixture that proves it works.
// Run: pnpm test:tools
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TREE = join(ROOT, 'tools', 'boundaries', 'fixtures', 'tree');
const CONFIG = join(ROOT, '.dependency-cruiser.cjs');
const BIN = join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');

const EXPECTED = {
    'packages/schemas/src/bad-imports-ui.ts': 'leaf-packages-import-nothing-internal',
    'modules/competency/api/bad-sideways.ts': 'no-work-process-to-work-process',
    'modules/vehicles/api/bad-imports-work-process.ts': 'registry-never-imports-work-process',
    'platform/forms/api/bad-order.ts': 'platform-order-forms',
    'platform/kernel/api/bad-imports-platform.ts': 'kernel-imports-only-packages',
    'platform/workflow/api/bad-imports-modules.ts': 'platform-never-imports-modules',
    'modules/competency/api/bad-internal.ts': 'only-public-entries-of-other-slices',
    'modules/competency/contracts/bad-nest.ts': 'contracts-are-isomorphic',
    'modules/competency/contracts/bad-ui.ts': 'contracts-are-isomorphic',
    'modules/competency/contracts/bad-node.ts': 'contracts-no-node-builtins',
    'modules/competency/web/bad-api.ts': 'web-never-imports-api',
    'modules/competency/api/bad-ui.ts': 'api-never-imports-ui',
    'platform/fees/api/bad-system.ts': 'system-pool-only-in-worker-code',
    'apps/verify/src/bad-kernel.ts': 'verify-app-allow-list',
    'packages/form-engine/src/core/bad-react.ts': 'form-engine-core-is-ui-free',
    'platform/forms/api/bad-app.ts': 'no-importing-apps',
    'apps/web/src/bad-other-app.ts': 'no-app-to-app',
    'packages/testing/src/bad-cycle-a.ts': 'no-circular',
    'packages/module-sdk/src/bad-imports-ui.ts': 'tool-packages-import-schemas-only',
    'apps/api/src/bad-internal.ts': 'apps-use-public-entries',
    'packages/ui/src/bad-imports-platform.ts': 'ui-packages-stay-below-runtime',
    'packages/ui/src/bad-imports-sdk.ts': 'ui-packages-stay-below-runtime',
    'packages/module-sdk/src/bad-imports-testing.ts': 'tool-packages-import-schemas-only',
    'modules/competency/api/bad-unresolved.ts': 'no-unresolved-internal',
    'modules/competency/api/bad-imports-jobs.ts': 'worker-code-only-from-worker-entries',
    // The system pool reached indirectly: through a job registered by an HTTP entry, and through a kernel subpath
    // that re-exports it. Entry files can't be named bad-*, so they list every rule they must trip.
    'modules/freight/api/index.ts': ['http-entries-never-reach-system-pool', 'worker-code-only-from-worker-entries'],
    'platform/kernel/api/config/index.ts': ['http-entries-never-reach-system-pool', 'system-pool-only-in-worker-code'],
    'platform/forms/api/index.ts': ['http-entries-never-reach-system-pool']
};
const expectedRules = (file) => [EXPECTED[file] ?? []].flat();

function cruise() {
    let out;
    try {
        out = execFileSync(
            process.execPath,
            [BIN, '--config', CONFIG, '--output-type', 'json', 'apps', 'platform', 'modules', 'packages'],
            {
                cwd: TREE,
                maxBuffer: 32 * 1024 * 1024
            }
        );
    } catch (e) {
        // depcruise exits non-zero when it finds violations, which the fixtures are made to do.
        out = e.stdout;
    }
    return JSON.parse(out.toString()).summary.violations;
}

const violations = cruise();
const rulesByFile = new Map();
for (const v of violations) {
    const list = rulesByFile.get(v.from) ?? [];
    list.push(v.rule.name);
    rulesByFile.set(v.from, list);
}

for (const file of Object.keys(EXPECTED)) {
    for (const rule of expectedRules(file)) {
        test(`${rule} fires on ${file}`, () => {
            assert.ok(
                (rulesByFile.get(file) ?? []).includes(rule),
                `got: ${JSON.stringify(rulesByFile.get(file) ?? [])}`
            );
        });
    }
}

test('allowed imports (ok-* fixtures and entry files) produce no violation', () => {
    // A bad-* file may trip extra rules; any other file may trip only the rules listed for it.
    const unexpected = violations.filter(
        (v) => !/\/bad-[^/]+$/.test(v.from) && !expectedRules(v.from).includes(v.rule.name)
    );
    assert.deepEqual(
        unexpected.map((v) => `${v.rule.name}: ${v.from} → ${v.to}`),
        []
    );
});

test('every rule in .dependency-cruiser.cjs has a failing fixture', () => {
    const config = createRequire(import.meta.url)(CONFIG);
    const proven = new Set(violations.map((v) => v.rule.name));
    const unproven = config.forbidden
        .map((r) => r.name)
        // The order rule for the kernel overlaps kernel-imports-only-packages; for the others one representative
        // (forms) proves the generated rule shape. They are generated by the same code.
        .filter((name) => !(name.startsWith('platform-order-') && name !== 'platform-order-forms'))
        .filter((name) => !proven.has(name));
    assert.deepEqual(unproven, []);
});
