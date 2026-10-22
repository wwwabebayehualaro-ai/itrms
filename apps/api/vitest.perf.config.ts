// Performance checks on a real PostgreSQL 16 in a container (task 0.14: name search over 10^6 generated persons). Slow:
// run on demand and before a release: pnpm --filter @itrms/api test:perf.
export { default } from '@itrms/config/vitest/nest-perf';
