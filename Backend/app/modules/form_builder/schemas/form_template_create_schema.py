import re
from typing import Optional

from pydantic import Field, model_validator

from app.modules.form_builder.schemas.form_template_schema import FormTemplateBase


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


class FormTemplateCreate(FormTemplateBase):
    slug: Optional[str] = Field(None, max_length=255)  # generated from the name when omitted

    @model_validator(mode="after")
    def _generate_slug(self):
        if not self.slug:
            self.slug = slugify(self.name)
        return self
