from __future__ import annotations

import hashlib
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any, TypeVar

from fastapi import Depends, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.foundation import context
from app.foundation.db.session import get_database
from app.foundation.errors import BadRequest, Conflict, ValidationFailed
from app.foundation.idempotency.model import IdempotencyRecord
from app.foundation.security.deps import get_principal
from app.foundation.security.principal import Principal

HEADER = "Idempotency-Key"
TTL = timedelta(hours=24)
_KEY = re.compile(r"^[\x21-\x7e]{1,255}$")  # printable ASCII, no spaces

T = TypeVar("T")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)  # SQLite returns naive datetimes


class Idempotency:
    """One request's idempotency guard. Records live in their own short transactions, so a concurrent duplicate sees the
    first call's marker immediately and the business transaction stays untouched."""

    def __init__(self, key: str | None, principal: Principal, method: str, path: str, request_hash: str, status_code: int):
        self.key, self.principal, self.method, self.path, self.request_hash, self.status_code = key, principal, method, path, request_hash, status_code

    async def _claim(self) -> IdempotencyRecord | None:
        """Insert the running marker; return the existing record instead when the key was used before (and is not expired)."""
        async with get_database().sessionmaker() as s:
            existing = (await s.execute(select(IdempotencyRecord).where(IdempotencyRecord.actor_id == self.principal.user_id, IdempotencyRecord.key == self.key))).scalars().first()
            if existing is not None and _aware(existing.expires_at) > _now():
                return existing
            if existing is not None:
                await s.delete(existing)
                await s.flush()
            s.add(IdempotencyRecord(actor_id=self.principal.user_id, key=self.key, method=self.method, path=self.path, request_hash=self.request_hash,
                                    state="running", expires_at=_now() + TTL))
            try:
                await s.commit()
            except IntegrityError:  # a concurrent call with the same key got there first
                await s.rollback()
                return (await s.execute(select(IdempotencyRecord).where(IdempotencyRecord.actor_id == self.principal.user_id, IdempotencyRecord.key == self.key))).scalars().first()
        return None

    async def _finish(self, body: Any | None) -> None:
        async with get_database().sessionmaker() as s:
            stmt = select(IdempotencyRecord).where(IdempotencyRecord.actor_id == self.principal.user_id, IdempotencyRecord.key == self.key)
            record = (await s.execute(stmt)).scalars().first()
            if record is None:
                return
            if body is None:  # failed: forget the key so the client can retry
                await s.delete(record)
            else:
                record.state, record.response_status, record.response_body = "done", self.status_code, body
            await s.commit()

    async def run(self, fn: Callable[[], Awaitable[T]]) -> T | JSONResponse:
        if not self.key:
            return await fn()
        existing = await self._claim()
        if existing is not None:
            if existing.request_hash != self.request_hash:
                raise ValidationFailed(f"This {HEADER} was already used for a different request", code="idempotency_key_reused")
            if existing.state != "done":
                raise Conflict("The same request is still being processed", code="idempotency_in_progress")
            return JSONResponse(existing.response_body, status_code=existing.response_status or 200, headers={"Idempotent-Replayed": "true"})
        try:
            result = await fn()
        except BaseException:
            await self._finish(None)
            raise
        await self._finish(jsonable_encoder(result))
        return result


def idempotency():
    """Route dependency: `idem: Idempotency = Depends(idempotency())`, then `return await idem.run(lambda: ...)`."""

    async def dependency(request: Request, principal: Principal = Depends(get_principal)) -> Idempotency:
        key = request.headers.get(HEADER)
        if key is not None and not _KEY.match(key):
            raise BadRequest(f"{HEADER} must be 1-255 printable characters", code="invalid_idempotency_key")
        body = await request.body()  # cached by Starlette: the endpoint still parses it
        digest = hashlib.sha256(b"\n".join([request.method.encode(), request.url.path.encode(), body])).hexdigest()
        route = request.scope.get("route")
        return Idempotency(key, principal, request.method, request.url.path, digest, getattr(route, "status_code", None) or 200)

    return dependency


async def purge_expired() -> int:
    """Delete expired records of every tenant (operator command / scheduled job)."""
    with context.system_context():
        async with get_database().sessionmaker() as s:
            result = await s.execute(delete(IdempotencyRecord).where(IdempotencyRecord.expires_at < _now()))
            await s.commit()
            return result.rowcount or 0
