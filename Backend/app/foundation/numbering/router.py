"""/platform/sequences: what document number sequences exist and where they stand (admin, read-only)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation.db.session import get_session
from app.foundation.numbering import sequences
from app.foundation.security import permissions
from app.foundation.security.deps import require, secure_router

permissions.register("sequence", ["read"], sensitive=True)

router = secure_router(prefix="/platform/sequences", tags=["platform"])


class SequenceOut(BaseModel):
    key: str
    title: str
    pattern: str
    reset: str
    period: str = Field(description="Current period ('' when the sequence never resets)")
    next_value: int
    next_number: str = Field(description="What the next document will get (fields other than the date and {seq} shown as {name})")


class _Keep(dict):
    def __missing__(self, key):  # leave caller-supplied fields (e.g. {branch}) visible in the preview
        return "{" + key + "}"


@router.get("", response_model=list[SequenceOut], dependencies=[Depends(require("sequence:read"))])
async def list_sequences(session: AsyncSession = Depends(get_session)):
    now = datetime.now(timezone.utc)
    values = await sequences.current_values(session)
    out = []
    for d in sequences.definitions():
        period = d.period(now)
        nxt = values.get((d.key, period), 1)
        preview = d.pattern.format_map(_Keep(seq=nxt, yyyy=f"{now:%Y}", yy=f"{now:%y}", mm=f"{now:%m}"))
        out.append(SequenceOut(key=d.key, title=d.title, pattern=d.pattern, reset=d.reset, period=period, next_value=nxt, next_number=preview))
    return out
