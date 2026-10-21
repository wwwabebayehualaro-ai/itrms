/**
 * @itrms/kernel/db: the database of a process and the only way to write business rows (ADR-0003, ADR-0018). Request code
 * opens `db.scoped(ctx, tx => …)` and writes through the audited helpers; the system pool (`@itrms/kernel/db/system`) is
 * the worker's alone.
 */
import { fileURLToPath } from 'node:url';

export { createDatabase, type Database, type DatabaseOptions, type Db, type DbContext, type Tx } from './database';
export { baseColumns, ltree, newId } from './columns';
export { audited, auditOptionsOf, auditPolicyOf, notAudited, type AuditOptions } from './audit-policy';
export {
    deleteAudited,
    insertAudited,
    plain,
    recordEvent,
    updateAudited,
    type AuditEvent,
    type BaseTable
} from './audit';
export { AUDIT_ACTIONS, auditLog, kernelSchema, type AuditAction } from './audit-log.table';
export { declaredRlsTables, RLS_CLASSES, rlsOf, rlsPolicies, withRls, type RlsClass, type RlsDeclaration } from './rls';

/** The role bootstrap (roles.psql), run by a superuser before the migrations: the dev stack and the tests read it. */
export const ROLES_SQL = fileURLToPath(new URL('./sql/roles.psql', import.meta.url));
