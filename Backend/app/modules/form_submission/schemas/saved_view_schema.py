"""Saved views of the data viewer."""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.foundation.db.json_query import MAX_CONDITIONS, MAX_DEPTH
from app.modules.form_submission.schemas.form_submission_query_schema import Condition, FilterGroup, SortKey

MODE_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
MAX_OPTIONS_BYTES = 4000


def _measure(node: Condition | FilterGroup, depth: int = 0) -> tuple[int, int]:
    if isinstance(node, Condition):
        return 1, depth
    n, d = 0, depth
    for item in node.items:
        cn, cd = _measure(item, depth + 1)
        n, d = n + cn, max(d, cd)
    return n, d


class ViewConfig(BaseModel):
    """What a view remembers. Bounded: it is stored as is and applied through the normal (validated) query path."""

    mode: str = "table"
    search: str = Field(default="", max_length=100)
    filter: FilterGroup = Field(default_factory=FilterGroup)
    sort: list[SortKey] = Field(default_factory=list, max_length=3)
    columns: list[str] = Field(default_factory=list, max_length=50)
    page_size: int = Field(default=20, ge=1, le=100)
    options: dict[str, Any] = Field(default_factory=dict)

    @field_validator("mode")
    @classmethod
    def _mode(cls, v: str) -> str:
        if not MODE_RE.match(v):
            raise ValueError("invalid view mode")
        return v

    @field_validator("columns")
    @classmethod
    def _columns(cls, v: list[str]) -> list[str]:
        if any(len(c) > 64 for c in v):
            raise ValueError("column key too long")
        return v

    @model_validator(mode="after")
    def _bounded(self):
        n, depth = _measure(self.filter)
        if n > MAX_CONDITIONS or depth > MAX_DEPTH:
            raise ValueError("filter is too large")
        if len(json.dumps(self.options, default=str)) > MAX_OPTIONS_BYTES:
            raise ValueError("options are too large")
        return self


class SavedViewCreate(BaseModel):
    template_id: UUID
    name: str = Field(min_length=1, max_length=120)
    visibility: Literal["private", "shared"] = "private"
    is_default: bool = False
    config: ViewConfig

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class SavedViewUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    visibility: Optional[Literal["private", "shared"]] = None
    is_default: Optional[bool] = None
    config: Optional[ViewConfig] = None


class SavedViewOut(BaseModel):
    id: UUID
    template_id: UUID
    name: str
    visibility: str
    is_default: bool
    config: dict
    created_by: Optional[UUID] = None
    owner_name: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    row_version: int = 1
    #: whether the caller may change or delete it
    can_edit: bool = False
