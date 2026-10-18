"""Platform baseline: tenants, users, audit trail, stored files; adopt legacy form tables.

Works on an empty database and on one created by the pre-platform `Base.metadata.create_all`:
legacy rows are assigned to a 'default' tenant so nothing is lost.

Revision ID: 0001
Revises:
"""
import uuid

import sqlalchemy as sa
from alembic import op

from app.foundation.db.base import Base
from app.foundation.db.rls import audit_immutability_sql, enable_rls_sql
import app.models  # noqa: F401

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

RLS_TABLES = ("form_templates", "form_submissions", "users", "stored_files")
GUID = sa.Uuid(as_uuid=True)


def _cols(insp, table):
    return {c["name"]: c for c in insp.get_columns(table)}


def _default_tenant(bind) -> uuid.UUID:
    row = bind.execute(sa.text("SELECT id FROM tenants WHERE slug = 'default'")).first()
    if row:
        return row[0]
    tid = uuid.uuid4()
    bind.execute(sa.text("INSERT INTO tenants (id, name, slug, is_active, created_at) VALUES (:id, 'Default', 'default', true, now())"), {"id": tid})
    return tid


def _adopt_legacy(bind, insp, table, extra_steps):
    cols = _cols(insp, table)
    tid = None
    has_rows = bind.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first() is not None
    if "tenant_id" not in cols:
        op.add_column(table, sa.Column("tenant_id", GUID, nullable=True))
        if has_rows:
            tid = _default_tenant(bind)
            bind.execute(sa.text(f"UPDATE {table} SET tenant_id = :t"), {"t": tid})
        op.alter_column(table, "tenant_id", nullable=False)
        op.create_foreign_key(f"fk_{table}_tenant_id_tenants", table, "tenants", ["tenant_id"], ["id"], ondelete="RESTRICT")
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
    for name, col in (("updated_by", sa.Column("updated_by", GUID, nullable=True)), ("deleted_by", sa.Column("deleted_by", GUID, nullable=True)),
                      ("row_version", sa.Column("row_version", sa.Integer, nullable=False, server_default="1"))):
        if name not in cols:
            op.add_column(table, col)
    if "created_by" not in cols:
        op.add_column(table, sa.Column("created_by", GUID, nullable=True))
    extra_steps(cols)


def _timestamp_column(table, cols, name, index=False):
    """Legacy schemas sometimes typed these as TIME; a time-of-day carries no usable information, so it is replaced."""
    col = cols.get(name)
    if col is not None and str(col["type"]).upper().startswith("TIME") and "STAMP" not in str(col["type"]).upper():
        op.drop_column(table, name)
        col = None
    if col is None:
        op.add_column(table, sa.Column(name, sa.DateTime(timezone=True), nullable=True))
        if index:
            op.create_index(f"ix_{table}_{name}", table, [name])


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())
    md = Base.metadata.tables

    for name in ("tenants", "users", "refresh_tokens", "audit_logs", "stored_files"):
        if name not in existing:
            md[name].create(bind)

    # ---- legacy form_templates ------------------------------------------------
    if "form_templates" not in existing:
        md["form_templates"].create(bind)
    else:
        def templates(cols):
            for uc in insp.get_unique_constraints("form_templates"):
                if uc["column_names"] == ["slug"]:
                    op.drop_constraint(uc["name"], "form_templates", type_="unique")
            for ix in insp.get_indexes("form_templates"):
                if ix.get("unique") and ix["column_names"] == ["slug"]:
                    op.drop_index(ix["name"], table_name="form_templates")
            _timestamp_column("form_templates", cols, "deleted_at", index=True)
            op.create_index("uq_form_templates_tenant_slug", "form_templates", ["tenant_id", "slug"], unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
            bind.execute(sa.text("UPDATE form_templates SET created_at = now() WHERE created_at IS NULL"))
        _adopt_legacy(bind, insp, "form_templates", templates)

    # ---- legacy form_submissions ----------------------------------------------
    if "form_submissions" not in existing:
        # 0001 builds tables from the live models; form_submissions now references template_versions (added by 0003, which
        # skips what already exists), so that table has to exist first on a fresh database
        if "template_versions" not in existing:
            md["template_versions"].create(bind)
        md["form_submissions"].create(bind)
    else:
        def submissions(cols):
            _timestamp_column("form_submissions", cols, "updated_at")
            _timestamp_column("form_submissions", cols, "deleted_at", index=True)
            if "is_deleted" in cols:
                bind.execute(sa.text("UPDATE form_submissions SET deleted_at = COALESCE(created_at, now()) WHERE is_deleted IS TRUE AND deleted_at IS NULL"))
                op.drop_column("form_submissions", "is_deleted")
            bind.execute(sa.text("UPDATE form_submissions SET created_by = submitted_by WHERE created_by IS NULL"))
            op.create_index("ix_form_submissions_template_id", "form_submissions", ["template_id"])
            op.create_index("ix_form_submissions_status", "form_submissions", ["status"])
        _adopt_legacy(bind, insp, "form_submissions", submissions)

    if bind.dialect.name == "postgresql":
        for stmt in audit_immutability_sql():
            bind.execute(sa.text(stmt))
        for table in RLS_TABLES:
            for stmt in enable_rls_sql(table):
                bind.execute(sa.text(stmt))


def downgrade() -> None:
    raise NotImplementedError("The platform baseline is not reversible (it adopts and transforms existing data); restore from backup instead.")
