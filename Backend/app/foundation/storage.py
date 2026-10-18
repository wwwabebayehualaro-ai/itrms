"""Blob storage abstraction. Feature code depends on `Storage`; swap `LocalStorage` for S3/Azure without touching it."""
from __future__ import annotations

import os
import shutil
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Protocol

import aiofiles


class Storage(Protocol):
    async def save(self, key: str, chunks: AsyncIterator[bytes]) -> int: ...
    def path(self, key: str) -> Path: ...
    async def delete(self, key: str) -> None: ...


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root).resolve()

    def path(self, key: str) -> Path:
        target = (self.root / key).resolve()
        if not target.is_relative_to(self.root):  # defence against traversal via crafted keys
            raise ValueError("invalid storage key")
        return target

    async def save(self, key: str, chunks: AsyncIterator[bytes]) -> int:
        target = self.path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".part")
        written = 0
        try:
            async with aiofiles.open(tmp, "wb") as fh:
                async for chunk in chunks:
                    written += len(chunk)
                    await fh.write(chunk)
            os.replace(tmp, target)  # atomic publish
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        return written

    async def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)

    def wipe(self) -> None:  # tests
        shutil.rmtree(self.root, ignore_errors=True)
