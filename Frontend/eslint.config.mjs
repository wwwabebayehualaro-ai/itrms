// ESLint 9 flat config. The import rules enforce the platform boundaries described in platform/README.md:
// feature code (app/, layout/) uses the platform only through its public entry points, and the platform never imports features.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

const featureCode = ['app/**/*.{ts,tsx,js,jsx}', 'layout/**/*.{ts,tsx}'];

const noFeatureImports = {
    group: ['@/app/*', '@/layout/*'],
    message: 'The platform must not import feature code (app/, layout/).'
};

// UI vendors behind the design system (Docs/architecture/ui-migration.md): Radix only inside the shadcn primitives; PrimeReact
// was removed (stage D) and must not come back. Checked with no-restricted-syntax so the no-restricted-imports options above stay.
const vendorImport = (pattern, message) => ({ selector: `ImportDeclaration[source.value=/${pattern}/]`, message });
const NO_PRIME = vendorImport('^(primereact|primeflex|primeicons)(\\u002F|$)', 'PrimeReact was removed: build UI from the design system ("@platform/ui").');
const NO_RADIX = vendorImport('^(radix-ui|@radix-ui\\u002F)', 'Radix is wrapped by the design system: import the primitive from "@platform/ui".');

export default defineConfig([
    ...nextVitals,
    globalIgnores(['.next/**', '.next-*/**', 'out/**', 'build/**', 'next-env.d.ts', 'public/**', 'scripts/e2e/**/out/**', 'playwright-report/**', 'test-results/**']),
    {
        files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
        rules: {
            '@next/next/no-img-element': 'off',
            // every React Compiler rule of eslint-plugin-react-hooks 7 is an error (incompatible-library stays a warning: it reports
            // libraries such as TanStack Table that the compiler skips, not mistakes)
            'react-hooks/refs': 'error',
            'react-hooks/set-state-in-effect': 'error',
            'react-hooks/preserve-manual-memoization': 'error',
            'react-hooks/use-memo': 'error'
        }
    },
    {
        files: featureCode,
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        { name: 'axios', message: "Use the platform client: import axiosInstance from '@platform/lib/api/client' (it owns authentication)." }
                    ],
                    patterns: [
                        {
                            group: ['@platform/form-engine/*', '!@platform/form-engine/builder'],
                            message: "Import the form engine only from '@platform/form-engine' or '@platform/form-engine/builder'."
                        },
                        { group: ['@platform/ui/*', '!@platform/ui/code/*'], message: "Import shared UI from '@platform/ui'." }
                    ]
                }
            ],
            'no-restricted-globals': ['error', { name: 'fetch', message: "Use the platform client '@platform/lib/api/client' so authentication, errors and tracing apply." }],
            'no-eval': 'error',
            'no-new-func': 'error'
        }
    },
    {
        files: ['platform/**/*.{ts,tsx,js,jsx,mts}'],
        rules: {
            'no-restricted-imports': ['error', { patterns: [noFeatureImports] }],
            'no-eval': 'error',
            'no-new-func': 'warn'
        }
    },
    {
        files: ['platform/lib/**/*.{ts,tsx}', 'platform/ui/**/*.{ts,tsx,jsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@platform/form-engine', '@platform/form-engine/*'],
                            message: 'platform/lib and platform/ui are lower layers: they must not import the form engine.'
                        },
                        noFeatureImports
                    ]
                }
            ]
        }
    },
    {
        files: ['app/**/*.{ts,tsx,js,jsx}', 'layout/**/*.{ts,tsx}', 'platform/**/*.{ts,tsx,js,jsx,mts}'],
        ignores: ['platform/ui/primitives/**'],
        rules: { 'no-restricted-syntax': ['error', NO_PRIME, NO_RADIX] }
    },
    {
        files: ['platform/ui/primitives/**'],
        rules: { 'no-restricted-syntax': ['error', NO_PRIME] }
    }
]);
