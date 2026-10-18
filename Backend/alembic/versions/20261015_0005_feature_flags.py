"""Feature flags: per-tenant overrides of module and feature switches.

Revision ID: 0005
Revises: fd78bd8cb50e
"""
import sqlalchemy as sa
from alembic import op

from app.foundation.db.base import Base
from app.foundation.db.rls import enable_rls_sql
import app.models  # noqa: F401

revision = "0005"
down_revision = "fd78bd8cb50e"  # the drift cleanup applied to existing development databases
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "feature_flags" not in sa.inspect(bind).get_table_names():
        Base.metadata.tables["feature_flags"].create(bind)
    if bind.dialect.name == "postgresql":
        for stmt in enable_rls_sql("feature_flags"):
            bind.execute(sa.text(stmt))


def downgrade() -> None:
    op.drop_table("feature_flags")
