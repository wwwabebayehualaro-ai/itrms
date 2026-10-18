"""Liveness/readiness/metrics endpoints (unauthenticated, no tenant data)."""
from __future__ import annotations

from fastapi import APIRouter, Response
from sqlalchemy import text

from app.foundation.config import get_settings
from app.foundation.db.session import get_database
from app.foundation.observability import metrics

router = APIRouter(tags=["ops"], include_in_schema=False)


@router.get("/healthz")
async def liveness():
    return {"status": "ok"}


@router.get("/readyz")
async def readiness(response: Response):
    try:
        async with get_database().engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ready", "checks": {"database": "ok"}}
    except Exception:  # noqa: BLE001
        response.status_code = 503
        return {"status": "unavailable", "checks": {"database": "down"}}


@router.get("/metrics")
async def prometheus():
    if not get_settings().metrics_enabled:
        return Response(status_code=404)
    body, ctype = metrics.render()
    return Response(body, media_type=ctype)
