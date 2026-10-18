from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.modules.form_submission.schemas.form_submission_schema import FormSubmissionMetadata, FormSubmissionStatus


class FormSubmissionUpdate(BaseModel):
    """Partial update of a submission."""

    model_config = ConfigDict(extra="ignore")

    submission_data: Optional[Dict[str, Any]] = Field(None, description="Replacement submission data")
    files_uploaded: Optional[Dict[str, Any]] = None
    form_metadata: Optional[FormSubmissionMetadata] = None
    status: Optional[FormSubmissionStatus] = None

    def update_dict(self) -> Dict[str, Any]:
        return self.model_dump(exclude_unset=True, exclude_none=True, mode="json")


class FormSubmissionStatusUpdate(BaseModel):
    status: FormSubmissionStatus = Field(..., description="New status to set")
