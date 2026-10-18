from typing import List
from uuid import UUID

from fastapi import Depends, File, Path, Response, UploadFile, status
from fastapi.responses import FileResponse

from app.foundation.security import permissions
from app.foundation.security.deps import require, secure_router
from app.modules.files.models.StoredFile import StoredFile
from app.modules.files.schemas.file_schema import BatchUploadResponse, FileUploadResponse
from app.modules.files.services.file_service import INLINE_TYPES, FileService, get_file_service

permissions.register("file", ["create", "read", "delete"])

router = secure_router(prefix="/upload", tags=["upload"])


def _to_response(f: StoredFile) -> FileUploadResponse:
    return FileUploadResponse(file_id=f.id, filename=f.filename, content_type=f.content_type, size=f.size, url=f"/files/upload/{f.id}/preview",
                              metadata=f.file_metadata or {})


@router.post("", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require("file:create"))])
async def upload_single_file(file: UploadFile = File(...), svc: FileService = Depends(get_file_service)):
    try:
        return _to_response(await svc.upload(file))
    finally:
        await file.close()


@router.post("/batch", response_model=BatchUploadResponse, dependencies=[Depends(require("file:create"))])
async def batch_upload_files(files: List[UploadFile] = File(...), svc: FileService = Depends(get_file_service)):
    try:
        return BatchUploadResponse(files=[_to_response(await svc.upload(f)) for f in files])
    finally:
        for f in files:
            await f.close()


@router.get("/{file_id}/preview", summary="Preview file in browser", dependencies=[Depends(require("file:read"))])
async def preview_file(file_id: UUID = Path(...), svc: FileService = Depends(get_file_service)):
    record, path = await svc.open(file_id)
    if record.content_type not in INLINE_TYPES:  # anything that could execute in the browser is forced to download
        return FileResponse(path, media_type=record.content_type, filename=record.filename)
    return FileResponse(path, media_type=record.content_type, content_disposition_type="inline", filename=record.filename,
                        headers={"Content-Security-Policy": "sandbox; default-src 'none'"})


@router.get("/{file_id}/download", summary="Download file", dependencies=[Depends(require("file:read"))])
async def download_file(file_id: UUID = Path(...), svc: FileService = Depends(get_file_service)):
    record, path = await svc.open(file_id)
    return FileResponse(path, media_type=record.content_type, filename=record.filename)  # Starlette encodes the header safely


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete file", dependencies=[Depends(require("file:delete"))])
async def delete_file(file_id: UUID = Path(...), svc: FileService = Depends(get_file_service)):
    await svc.remove(file_id)
    return Response(status_code=204)


@router.get("/{file_id}", response_model=FileUploadResponse, summary="Get file info", dependencies=[Depends(require("file:read"))])
async def get_file_info(file_id: UUID = Path(...), svc: FileService = Depends(get_file_service)):
    return _to_response(await svc.repo.get(file_id))
