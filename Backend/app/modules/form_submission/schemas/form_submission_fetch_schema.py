from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import UUID4, BaseModel, ConfigDict

from app.modules.form_submission.schemas.form_submission_schema import FormSubmissionBase


class FormSubmissionResponse(FormSubmissionBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    version: Optional[str] = None
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    row_version: int = 1


class FormSubmissionListItem(FormSubmissionResponse):
    pass


class SubmissionQueryParams(BaseModel):
    template_id: Optional[UUID4] = None
    status: Optional[str] = None
    created_after: Optional[datetime] = None
    #: only the requests the signed-in person submitted
    mine: bool = False


class PaginatedSubmissions(BaseModel):
    items: List[FormSubmissionListItem]
    total: int
    page: int
    page_size: int
