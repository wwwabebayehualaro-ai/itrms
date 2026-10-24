// ESLint flat config of the web app: Next.js rules (incl. the React Compiler rules) plus the boundaries of the app's own
// layers. The workspace-wide layer rules (packages → platform → modules, ui never importing the app) are dependency-cruiser's
// (pnpm boundaries). Typed linting of this legacy code comes as it is replaced (follow-up of task 0.4).
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

const featureCode = [
    'app/**/*.{ts,tsx,js,jsx}',
    'src/shell/**/*.{ts,tsx}',
    'src/screens/**/*.{ts,tsx}',
    'src/form-templates/**/*.{ts,tsx}'
];

// UI vendors behind the design system: Radix only inside @itrms/ui's primitives; PrimeReact was removed and must not return.
const vendorImport = (pattern, message) => ({ selector: `ImportDeclaration[source.value=/${pattern}/]`, message });
const NO_PRIME = vendorImport(
    '^(primereact|primeflex|primeicons)',
    'PrimeReact was removed: build UI from "@itrms/ui".'
);
const NO_RADIX = vendorImport(
    '^(radix-ui|@radix-ui)',
    'Radix is wrapped by the design system: import the primitive from "@itrms/ui".'
);

export default defineConfig([
    ...nextVitals,
    globalIgnores([
        '.next/**',
        '.next-*/**',
        'out/**',
        'build/**',
        'next-env.d.ts',
        'public/**',
        'scripts/e2e/**/out/**',
        'playwright-report/**',
        'test-results/**'
    ]),
    {
        files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
        rules: {
            '@next/next/no-img-element': 'off',
            // every React Compiler rule of eslint-plugin-react-hooks 7 is an error (incompatible-library stays a warning)
            'react-hooks/refs': 'error',
            'react-hooks/set-state-in-effect': 'error',
            'react-hooks/preserve-manual-memoization': 'error',
            'react-hooks/use-memo': 'error',
            'no-eval': 'error',
            'no-new-func': 'error',
            'no-restricted-syntax': ['error', NO_PRIME, NO_RADIX]
        }
    },
    {
        files: featureCode,
        // the BFF's route handlers call Keycloak and the API from the server: they are the client's other end
        // and the development /files route forwards to the object store, as Nginx does in production
        ignores: ['app/api/**', 'app/auth/**/route.ts', 'app/files/**/route.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [{ name: 'axios', message: "axios was replaced: use the client from '@/lib/api/client'." }]
                }
            ],
            'no-restricted-globals': [
                'error',
                {
                    name: 'fetch',
                    message: "Use the client '@/lib/api/client' so authentication, errors and tracing apply."
                }
            ]
        }
    },
    {
        files: ['src/lib/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'axios',
                            message: 'axios was replaced by the fetch-based client (src/lib/api/client.ts).'
                        }
                    ],
                    patterns: [
                        {
                            group: ['@itrms/form-engine', '@itrms/form-engine/*'],
                            message: 'src/lib is a lower layer: it must not import the form engine.'
                        }
                    ]
                }
            ]
        }
    }
]);
