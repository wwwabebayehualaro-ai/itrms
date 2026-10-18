from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class FormTemplateBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., max_length=255)
    version: str = Field(default="1.0.0", max_length=50)
    form_config: Union[Dict[str, Any], List[Any]] = Field(...)
    thumbnail_url: Optional[str] = Field(None, max_length=512)
    category: Optional[str] = Field(None, max_length=100)
    is_active: bool = Field(default=True)
    file_relations: Union[Dict[str, Any], List[Any]] = Field(default_factory=list)
