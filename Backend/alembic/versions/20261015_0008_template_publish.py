"""Form publish workflow: templates get a publish state and the version people fill in.

Every existing template is backfilled as published (its current content becomes a TemplateVersion if it is not one already),
so forms that take requests today keep taking them. New templates start as drafts.

Revision ID: 0008
Revises: 0007
"""
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

from app.foundation.db.base import Base
from app.foundation.db.types import GUID
import app.models  # noqa: F401
from app.modules.form_builder.services.versions import content_hash

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("form_templates")}
    with op.batch_alter_table("form_templates") as batch:
        if "status" not in columns:
            batch.add_column(sa.Column("status", sa.String(20), nullable=False, server_default="published"))
        if "published_version_id" not in columns:
            batch.add_column(sa.Column("published_version_id", GUID, nullable=True))
        if "published_at" not in columns:
            batch.add_column(sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    if "ix_form_templates_status" not in {i["name"] for i in sa.inspect(bind).get_indexes("form_templates")}:
        op.create_index("ix_form_templates_status", "form_templates", ["status"])

    templates = Base.metadata.tables["form_templates"]
    versions = Base.metadata.tables["template_versions"]
    now = datetime.now(timezone.utc)
    rows = bind.execute(sa.select(templates.c.id, templates.c.tenant_id, templates.c.form_config).where(templates.c.published_version_id.is_(None))).all()
    for template_id, tenant_id, form_config in rows:
        digest = content_hash(form_config)
        version_id = bind.execute(sa.select(versions.c.id).where(versions.c.template_id == template_id, versions.c.content_hash == digest)).scalar()
        if version_id is None:
            version_id = bind.execute(versions.insert().values(tenant_id=tenant_id, template_id=template_id, content_hash=digest, form_config=form_config)
                                      .returning(versions.c.id)).scalar()
        bind.execute(templates.update().where(templates.c.id == template_id).values(published_version_id=version_id, published_at=now, status="published"))

    # from now on a new template starts as a draft
    with op.batch_alter_table("form_templates") as batch:
        batch.alter_column("status", server_default="draft", existing_type=sa.String(20), existing_nullable=False)


def downgrade() -> None:
    op.drop_index("ix_form_templates_status", table_name="form_templates")
    with op.batch_alter_table("form_templates") as batch:
        batch.drop_column("published_at")
        batch.drop_column("published_version_id")
        batch.drop_column("status")
