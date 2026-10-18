from __future__ import annotations

from sqlalchemy import BigInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import EntityBase
from app.foundation.db.types import JSONType


class StoredFile(EntityBase):
    """Metadata for an uploaded file; the bytes live in the storage backend under `storage_key`."""

    __tablename__ = "stored_files"

    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(127))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    file_metadata: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
