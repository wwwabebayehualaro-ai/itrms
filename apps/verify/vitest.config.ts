import { defineConfig } from 'vitest/config';

export default defineConfig({
    esbuild: { jsx: 'automatic' },
    test: { environment: 'happy-dom', env: { TZ: 'Africa/Addis_Ababa' }, include: ['src/**/*.spec.{ts,tsx}'] }
});
