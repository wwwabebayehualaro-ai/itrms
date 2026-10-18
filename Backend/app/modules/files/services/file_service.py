from __future__ import annotations

import hashlib
import re
import uuid
from collections.abc import AsyncIterator
from functools import lru_cache
from pathlib import Path

from fastapi import Depends, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation.config import Settings, get_settings
from app.foundation.db.repository import CrudService, Repository
from app.foundation.db.session import get_session
from app.foundation.errors import BadRequest, PayloadTooLarge, UnsupportedMedia
from app.foundation.storage import LocalStorage, Storage
from app.modules.files.models.StoredFile import StoredFile

CHUNK = 64 * 1024
# Leading-bytes signatures: the declared Content-Type is never trusted on its own.
_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
    "application/pdf": (b"%PDF-",),
}
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"}


def sanitize_filename(name: str | None) -> str:
    base = Path((name or "file").replace("\\", "/")).name
    base = re.sub(r"[\x00-\x1f\x7f\"<>|:*?]", "_", base).strip(" .") or "file"
    return base[:255]


@lru_cache
def get_storage() -> Storage:
    return LocalStorage(get_settings().upload_dir)


class FileRepository(Repository[StoredFile]):
    model = StoredFile
    resource_name = "File"


class FileService(CrudService[StoredFile]):
    repository_class = FileRepository

    def __init__(self, session: AsyncSession, storage: Storage, settings: Settings):
        super().__init__(session)
        self.storage, self.s = storage, settings

    async def _stream(self, upload: UploadFile, head: bytearray, sha: "hashlib._Hash") -> AsyncIterator[bytes]:
        total = 0
        while chunk := await upload.read(CHUNK):
            total += len(chunk)
            if total > self.s.max_upload_bytes:
                raise PayloadTooLarge(f"File exceeds the {self.s.max_upload_bytes // (1024 * 1024)} MB limit")
            if len(head) < 16:
                head.extend(chunk[: 16 - len(head)])
            sha.update(chunk)
            yield chunk

    def _check_type(self, declared: str | None, head: bytes) -> str:
        ctype = (declared or "application/octet-stream").split(";")[0].strip().lower()
        if ctype not in self.s.allowed_upload_types:
            raise UnsupportedMedia(f"File type '{ctype}' is not allowed")
        sigs = _SIGNATURES.get(ctype)
        if sigs and not any(head.startswith(sig) for sig in sigs):
            raise UnsupportedMedia("File content does not match its declared type")
        return ctype

    async def upload(self, upload: UploadFile, metadata: dict | None = None) -> StoredFile:
        file_id = uuid.uuid4()
        # Tenant id is stamped by the session hook; the storage key only needs to be unguessable and collision-free.
        key = f"{file_id.hex[:2]}/{file_id}"
        head, sha = bytearray(), hashlib.sha256()
        ctype_declared = upload.content_type
        size = await self.storage.save(key, self._stream(upload, head, sha))
        try:
            ctype = self._check_type(ctype_declared, bytes(head))
            if size == 0:
                raise BadRequest("Empty file")
            return await self.create({"id": file_id, "filename": sanitize_filename(upload.filename), "content_type": ctype, "size": size,
                                      "sha256": sha.hexdigest(), "storage_key": key, "file_metadata": metadata or {}})
        except BaseException:
            await self.storage.delete(key)  # never leave orphan bytes behind
            raise

    async def open(self, file_id: uuid.UUID) -> tuple[StoredFile, Path]:
        record = await self.repo.get(file_id)
        path = self.storage.path(record.storage_key)
        if not path.exists():
            from app.foundation.errors import NotFound

            raise NotFound("File content is missing")
        return record, path

    async def remove(self, file_id: uuid.UUID) -> None:
        record = await self.repo.get(file_id)
        key = record.storage_key
        await self.delete(file_id)  # soft delete + audit; bytes are purged after the transaction succeeded
        await self.storage.delete(key)


async def get_file_service(session: AsyncSession = Depends(get_session)) -> FileService:
    return FileService(session, get_storage(), get_settings())
