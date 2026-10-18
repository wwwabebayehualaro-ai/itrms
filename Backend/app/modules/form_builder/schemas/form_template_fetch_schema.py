from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.modules.form_builder.schemas.form_template_schema import FormTemplateBase


class FormTemplateResponse(FormTemplateBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[UUID] = None
    row_version: int = 1
    status: Literal["draft", "pending_approval", "published"] = "draft"
    published_version_id: Optional[UUID] = None
    published_at: Optional[datetime] = None


class PublishedForm(BaseModel):
    """The form people fill in: the published version of a template."""

    template_id: UUID
    name: str
    version: str
    version_id: UUID
    published_at: Optional[datetime] = None
    form_config: Union[Dict[str, Any], List[Any]]
    file_relations: Union[Dict[str, Any], List[Any]]


class FormTemplateSearch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None
