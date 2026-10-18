from typing import Literal

from pydantic import Field

from app.modules.form_submission.schemas.form_submission_schema import FormSubmissionBase, FormSubmissionStatus


class FormSubmissionCreate(FormSubmissionBase):
    pass


class FormSubmissionCreateDraft(FormSubmissionBase):
    status: Literal[FormSubmissionStatus.DRAFT] = Field(FormSubmissionStatus.DRAFT, description="Always creates in draft status")
