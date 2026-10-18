from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field


class FormTemplateUpdate(BaseModel):
    """Partial update: only fields present in the request are changed."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    slug: Optional[str] = Field(None, max_length=255)
    version: Optional[str] = Field(None, max_length=50)
    form_config: Optional[Union[Dict[str, Any], List[Any]]] = None
    thumbnail_url: Optional[str] = Field(None, max_length=512)
    category: Optional[str] = Field(None, max_length=100)
    is_active: Optional[bool] = None
    file_relations: Optional[Union[Dict[str, Any], List[Any]]] = None
    row_version: Optional[int] = Field(None, description="Send the version you loaded to get a 409 instead of overwriting concurrent edits")
