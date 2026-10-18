from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import EntityBase
from app.foundation.db.types import GUID, JSONType

# draft: the working copy differs from what people fill in (or was never published); pending_approval: a publish waits for a
# second person's decision (feature flag forms.require_approval); published: people fill in exactly the working copy.
DRAFT, PENDING_APPROVAL, PUBLISHED = "draft", "pending_approval", "published"


class FormTemplate(EntityBase):
    __tablename__ = "form_templates"
    __table_args__ = (
        # unique among live rows only, so deleting a template frees its slug
        Index("uq_form_templates_tenant_slug", "tenant_id", "slug", unique=True, postgresql_where=text("deleted_at IS NULL"), sqlite_where=text("deleted_at IS NULL")),
    )

    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(255))
    version: Mapped[str] = mapped_column(String(50), server_default="1.0.0", default="1.0.0")
    form_config: Mapped[dict | list] = mapped_column(JSONType)
    thumbnail_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true", default=True)
    file_relations: Mapped[dict | list] = mapped_column(JSONType)
    status: Mapped[str] = mapped_column(String(20), default=DRAFT, server_default=DRAFT, index=True)
    #: the TemplateVersion people fill in (no FK: versions and templates reference each other; versions are never deleted alone)
    published_version_id: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
