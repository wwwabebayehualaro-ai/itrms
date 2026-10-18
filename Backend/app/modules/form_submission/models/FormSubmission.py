from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.foundation.db.base import EntityBase
from app.foundation.db.types import GUID, JSONType


class FormSubmission(EntityBase):
    __tablename__ = "form_submissions"
    # the data viewer pages one form's submissions newest-first: this serves that (and the status filter) from the index
    __table_args__ = (Index("ix_form_submissions_form_recent", "template_id", "created_at", "id"),)

    template_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("form_templates.id", ondelete="CASCADE"), index=True)
    submission_data: Mapped[dict] = mapped_column(JSONType)
    form_metadata: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    files_uploaded: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    status: Mapped[str | None] = mapped_column(String(63), nullable=True, index=True)
    version: Mapped[str | None] = mapped_column(String(63), nullable=True)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)
    #: the form content this data was filled in on (null for requests made before versions were recorded)
    template_version_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("template_versions.id"), nullable=True)

    template = relationship("FormTemplate", backref="submissions", lazy="raise")
