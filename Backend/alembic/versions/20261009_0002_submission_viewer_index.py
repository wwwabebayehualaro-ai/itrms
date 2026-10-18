"""Index for the data viewer: one form's submissions, newest first.

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

NAME = "ix_form_submissions_form_recent"


def _exists(bind) -> bool:
    return any(ix["name"] == NAME for ix in sa.inspect(bind).get_indexes("form_submissions"))


def upgrade() -> None:
    if not _exists(op.get_bind()):
        op.create_index(NAME, "form_submissions", ["template_id", "created_at", "id"])


def downgrade() -> None:
    if _exists(op.get_bind()):
        op.drop_index(NAME, table_name="form_submissions")
