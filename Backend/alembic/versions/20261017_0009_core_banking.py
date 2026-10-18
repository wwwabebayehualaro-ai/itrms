"""Core banking (simulated): accounts, ledger entries and teller transactions.

Revision ID: 0009
Revises: 0008
"""
import sqlalchemy as sa
from alembic import op

from app.foundation.db.base import Base
from app.foundation.db.rls import enable_rls_sql
import app.models  # noqa: F401

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

TABLES = ("bank_accounts", "bank_ledger_entries", "bank_transactions")


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    for table in TABLES:
        if table not in existing:
            Base.metadata.tables[table].create(bind)
        if bind.dialect.name == "postgresql":
            for stmt in enable_rls_sql(table):
                bind.execute(sa.text(stmt))


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
