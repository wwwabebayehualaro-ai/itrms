"""Request/response of the data-viewer query endpoint (one contract for every view mode)."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.foundation.db.json_query import AggFn, Op
from app.modules.form_submission.schemas.form_submission_fetch_schema import FormSubmissionResponse

ALIAS_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")


class Condition(BaseModel):
    field: str = Field(max_length=64)
    op: Op
    value: Any = None


class FilterGroup(BaseModel):
    op: Literal["and", "or"] = "and"
    items: list[Union[Condition, "FilterGroup"]] = Field(default_factory=list, max_length=50)


class SortKey(BaseModel):
    field: str = Field(max_length=64)
    desc: bool = False


class Aggregate(BaseModel):
    fn: AggFn
    field: Optional[str] = Field(default=None, max_length=64)
    alias: Optional[str] = None

    @field_validator("alias")
    @classmethod
    def _alias(cls, v):
        if v is not None and not ALIAS_RE.match(v):
            raise ValueError("alias must be a simple identifier")
        return v

    @property
    def name(self) -> str:
        return self.alias or (self.fn if self.field is None else f"{self.fn}_{self.field}")


class GroupBy(BaseModel):
    field: str = Field(max_length=64)
    bucket: Optional[Literal["year", "month", "day"]] = None  # dates only


class SubmissionQuery(BaseModel):
    template_id: UUID
    filter: Optional[FilterGroup] = None
    search: Optional[str] = Field(default=None, max_length=100)
    sort: list[SortKey] = Field(default_factory=list, max_length=3)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    #: aggregates over everything the filter matches (KPI tiles); count when empty is not computed
    aggregates: list[Aggregate] = Field(default_factory=list, max_length=8)
    group_by: Optional[GroupBy] = None
    #: a second dimension (pivot columns); only with group_by
    then_by: Optional[GroupBy] = None
    #: fields to count values of (filter sidebars / board columns)
    facets: list[str] = Field(default_factory=list, max_length=5)
    #: skip the rows when only totals/groups/facets are wanted (dashboards, boards)
    rows: bool = True


class SubmissionRow(FormSubmissionResponse):
    submitted_by_name: Optional[str] = None


class GroupResult(BaseModel):
    key: Optional[str] = None
    key2: Optional[str] = None  # value of then_by
    count: int
    aggregates: dict[str, Optional[float]] = Field(default_factory=dict)


class FacetValue(BaseModel):
    value: Optional[str] = None
    count: int


class SubmissionQueryResult(BaseModel):
    items: list[SubmissionRow]
    total: int
    page: int
    page_size: int
    aggregates: dict[str, Optional[float]] = Field(default_factory=dict)
    groups: list[GroupResult] = Field(default_factory=list)
    facets: dict[str, list[FacetValue]] = Field(default_factory=dict)


FilterGroup.model_rebuild()


class RecordForm(BaseModel):
    """The form a request is shown with: the version it was filled in on."""

    template_id: UUID
    name: str
    form_config: Any
    #: false for requests made before versions were recorded (shown with the current form)
    versioned: bool
    #: false when the form has been changed since this request was filled in
    current: bool


class FieldChange(BaseModel):
    field: str
    old: Any = None
    new: Any = None


class HistoryEntry(BaseModel):
    id: UUID
    action: str
    occurred_at: datetime
    actor_id: Optional[UUID] = None
    actor_name: Optional[str] = None
    changes: list[FieldChange] = Field(default_factory=list)


class ExportRequest(BaseModel):
    """Export what the viewer shows: same filter/search/sort, the chosen fields (default: all)."""

    template_id: UUID
    filter: Optional[FilterGroup] = None
    search: Optional[str] = Field(default=None, max_length=100)
    sort: list[SortKey] = Field(default_factory=list, max_length=3)
    fields: Optional[list[str]] = Field(default=None, max_length=100)
