/**
 * @itrms/kernel/tables: the kernel's table definitions and column types alone, for other slices' table files (foreign keys
 * to org units and users). It imports no service or controller, so drizzle-kit can load every *.table.ts.
 */
export { bytea } from '../crypto/crypto.table';
export { orgUnits } from '../org/org.table';
export { users } from '../iam/iam.table';
