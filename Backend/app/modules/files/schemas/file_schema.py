from typing import Dict, List

from pydantic import UUID4, BaseModel, ConfigDict


class FileUploadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    file_id: UUID4
    filename: str
    content_type: str
    size: int
    url: str
    metadata: Dict = {}


class BatchUploadResponse(BaseModel):
    files: List[FileUploadResponse]
