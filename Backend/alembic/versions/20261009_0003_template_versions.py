"""Template versions: remember the form a request was filled in on.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

from app.foundation.db.base import Base
from app.foundation.db.rls import enable_rls_sql
import app.models  # noqa: F401

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "template_versions" not in insp.get_table_names():
        Base.metadata.tables["template_versions"].create(bind)
    if "template_version_id" not in {c["name"] for c in insp.get_columns("form_submissions")}:
        with op.batch_alter_table("form_submissions") as batch:
            batch.add_column(sa.Column("template_version_id", sa.Uuid(as_uuid=True), sa.ForeignKey("template_versions.id"), nullable=True))
    if bind.dialect.name == "postgresql":
        for stmt in enable_rls_sql("template_versions"):
            bind.execute(sa.text(stmt))


def downgrade() -> None:
    with op.batch_alter_table("form_submissions") as batch:
        batch.drop_column("template_version_id")
    op.drop_table("template_versions")
