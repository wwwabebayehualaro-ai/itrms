from __future__ import annotations

import string
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation import context
from app.foundation.errors import BadRequest, Forbidden
from app.foundation.numbering.model import NumberSequence

Reset = Literal["never", "yearly", "monthly"]


@dataclass(frozen=True)
class SequenceDefinition:
    key: str
    title: str
    pattern: str
    reset: Reset

    def period(self, now: datetime) -> str:
        return {"never": "", "yearly": f"{now:%Y}", "monthly": f"{now:%Y-%m}"}[self.reset]

    def format(self, value: int, now: datetime, **fields: Any) -> str:
        return self.pattern.format(seq=value, yyyy=f"{now:%Y}", yy=f"{now:%y}", mm=f"{now:%m}", **fields)


_definitions: dict[str, SequenceDefinition] = {}


def register(key: str, *, title: str, pattern: str = "{seq:06}", reset: Reset = "never") -> SequenceDefinition:
    """Declare a sequence. Pattern fields: {seq} (with a width, e.g. {seq:05}), {yyyy}, {yy}, {mm}; any other field must be
    passed to `next_number` (e.g. a branch code)."""
    names = {name for _, name, _, _ in string.Formatter().parse(pattern) if name}
    if "seq" not in names:
        raise ValueError(f"sequence {key!r}: the pattern needs a {{seq}} field")
    definition = SequenceDefinition(key, title, pattern, reset)
    _definitions[key] = definition
    return definition


def definition(key: str) -> SequenceDefinition | None:
    return _definitions.get(key)


def definitions() -> list[SequenceDefinition]:
    return sorted(_definitions.values(), key=lambda d: d.key)


async def _advance(session: AsyncSession, key: str, period: str) -> int | None:
    stmt = (update(NumberSequence).where(NumberSequence.key == key, NumberSequence.period == period)
            .values(next_value=NumberSequence.next_value + 1).returning(NumberSequence.next_value))
    row = (await session.execute(stmt)).first()
    return None if row is None else row[0] - 1


async def next_number(session: AsyncSession, key: str, *, now: datetime | None = None, **fields: Any) -> str:
    """Take the next number of `key` for the current tenant, inside the caller's transaction (commit with the document)."""
    d = _definitions.get(key)
    if d is None:
        raise BadRequest(f"Unknown number sequence '{key}'", code="unknown_sequence")
    tenant_id = context.tenant_id_var.get()
    if tenant_id is None:
        raise Forbidden("Numbers are issued per tenant")
    now = now or datetime.now(timezone.utc)
    period = d.period(now)
    value = await _advance(session, key, period)
    if value is None:  # first number of this sequence/period: create the counter (a concurrent creator wins, then we advance)
        try:
            async with session.begin_nested():
                session.add(NumberSequence(tenant_id=tenant_id, key=key, period=period, next_value=2))
            value = 1
        except IntegrityError:
            value = await _advance(session, key, period)
            if value is None:  # pragma: no cover - the row exists after the conflict
                raise
    return d.format(value, now, **fields)


async def current_values(session: AsyncSession) -> dict[tuple[str, str], int]:
    """(key, period) -> next value, for the current tenant."""
    rows = (await session.execute(select(NumberSequence.key, NumberSequence.period, NumberSequence.next_value))).all()
    return {(r.key, r.period): r.next_value for r in rows}
