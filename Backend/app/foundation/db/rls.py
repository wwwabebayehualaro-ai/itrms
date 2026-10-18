"""PostgreSQL row-level security as a second line of defence behind the ORM tenant guard.

`enable_rls_sql(table)` returns idempotent DDL used by migrations. Policies compare the row's tenant_id with the
`app.tenant_id` setting that the session hook sets for each transaction; `app.bypass_rls = on` is set only inside
`system_context()`. Connect the application with a role that is NOT the table owner (owners bypass RLS unless FORCE is set).
"""


def enable_rls_sql(table: str) -> list[str]:
    policy = f"{table}_tenant_isolation"
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY",
        f"DROP POLICY IF EXISTS {policy} ON {table}",
        (
            f"CREATE POLICY {policy} ON {table} USING ("
            f"current_setting('app.bypass_rls', true) = 'on' OR tenant_id::text = current_setting('app.tenant_id', true)"
            f") WITH CHECK ("
            f"current_setting('app.bypass_rls', true) = 'on' OR tenant_id::text = current_setting('app.tenant_id', true))"
        ),
    ]


def audit_immutability_sql() -> list[str]:
    return [
        "CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql",
        "DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs",
        "CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable()",
    ]
