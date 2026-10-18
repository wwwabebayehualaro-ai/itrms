from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import EntityBase
from app.foundation.db.types import GUID, JSONType


class TemplateVersion(EntityBase):
    """The content of a form as it was when a request was filled in. Identical content is stored once per template
    (unique on the hash), so a request costs one id, not a copy of the form. Immutable: rows are only ever added."""

    __tablename__ = "template_versions"
    __audited__ = False  # content-addressed and immutable; the template's own audit trail records the edits
    __table_args__ = (Index("uq_template_versions_content", "template_id", "content_hash", unique=True),)

    template_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("form_templates.id", ondelete="CASCADE"), index=True)
    content_hash: Mapped[str] = mapped_column(String(64))
    form_config: Mapped[dict | list] = mapped_column(JSONType)
