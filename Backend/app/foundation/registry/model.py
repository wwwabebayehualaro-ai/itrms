from __future__ import annotations

from sqlalchemy import Boolean, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import EntityBase


class FeatureFlag(EntityBase):
    """A tenant's override of a feature flag's default. No row = the default from code."""

    __tablename__ = "feature_flags"
    __table_args__ = (
        Index("uq_feature_flags_tenant_key", "tenant_id", "key", unique=True, postgresql_where=text("deleted_at IS NULL"), sqlite_where=text("deleted_at IS NULL")),
    )

    key: Mapped[str] = mapped_column(String(100))
    enabled: Mapped[bool] = mapped_column(Boolean)
