"""Saved views of the data viewer.

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op

from app.foundation.db.base import Base
from app.foundation.db.rls import enable_rls_sql
import app.models  # noqa: F401

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "saved_views" not in sa.inspect(bind).get_table_names():
        Base.metadata.tables["saved_views"].create(bind)
    if bind.dialect.name == "postgresql":
        for stmt in enable_rls_sql("saved_views"):
            bind.execute(sa.text(stmt))


def downgrade() -> None:
    op.drop_table("saved_views")
