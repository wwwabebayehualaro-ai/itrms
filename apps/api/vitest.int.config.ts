// Integration tests on a real PostgreSQL 16 in a container (Testcontainers, tech-stack T30): the role bootstrap, the
// migration history from zero, the kernel's database helpers. Needs Docker: pnpm --filter @itrms/api test:int.
export { default } from '@itrms/config/vitest/nest-int';
