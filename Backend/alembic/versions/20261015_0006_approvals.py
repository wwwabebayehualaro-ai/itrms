"""Approval requests (maker-checker).

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op

from app.foundation.db.base import Base
from app.foundation.db.rls import enable_rls_sql
import app.models  # noqa: F401

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "approval_requests" not in sa.inspect(bind).get_table_names():
        Base.metadata.tables["approval_requests"].create(bind)
    if bind.dialect.name == "postgresql":
        for stmt in enable_rls_sql("approval_requests"):
            bind.execute(sa.text(stmt))


def downgrade() -> None:
    op.drop_table("approval_requests")
