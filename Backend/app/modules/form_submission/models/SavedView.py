from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import EntityBase
from app.foundation.db.types import GUID, JSONType


class SavedView(EntityBase):
    """A named way of looking at the submissions of one form: view mode, filters, sort, columns... (see ViewConfig).
    `private` views belong to their creator; `shared` ones are visible to everyone who can read the form's requests, and one of
    them can be the form's default."""

    __tablename__ = "saved_views"

    template_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("form_templates.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    visibility: Mapped[str] = mapped_column(String(16), default="private", server_default="private")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    config: Mapped[dict] = mapped_column(JSONType)
