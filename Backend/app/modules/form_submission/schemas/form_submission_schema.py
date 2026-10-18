from enum import Enum
from typing import Any, Dict, Optional

from pydantic import UUID4, BaseModel, ConfigDict, Field


class FormSubmissionStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class FormSubmissionMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    device_info: Optional[Dict[str, Any]] = None
    geolocation: Optional[Dict[str, Any]] = None
    submitted_via: Optional[str] = None
    submission_type: Optional[str] = None


class FormSubmissionBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    template_id: UUID4
    submission_data: Dict[str, Any] = Field(default_factory=dict)
    files_uploaded: Optional[Dict[str, Any]] = None
    form_metadata: Optional[FormSubmissionMetadata] = None
    status: Optional[FormSubmissionStatus] = FormSubmissionStatus.SUBMITTED
    submitted_by: Optional[UUID4] = None  # ignored on write: the authenticated user is always recorded
