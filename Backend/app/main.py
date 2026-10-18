"""Application factory. Run from `Backend/` with:  uvicorn app.main:app"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.foundation.auth import router as auth_router
from app.foundation.config import Settings, get_settings
from app.foundation.db.events import install_session_hooks
from app.foundation.db.session import get_database
from app.foundation.errors import register_error_handlers
from app.foundation.observability import health
from app.foundation.observability.logging import setup_logging
from app.foundation.observability.middleware import RequestContextMiddleware
from app.foundation.observability.tracing import setup_tracing
from app.foundation.platform import PLATFORM
from app.foundation.registry import registry
from app.modules import INSTALLED_MODULES
import app.models  # noqa: F401  (register every model with Base.metadata)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings.service_name, settings.env, settings.log_level)
    install_session_hooks()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await get_database().dispose()

    app = FastAPI(title="Digital File Cabinet API", version="2.0.0", lifespan=lifespan,
                  docs_url=None if settings.is_production else "/docs", redoc_url=None, openapi_url=None if settings.is_production else "/openapi.json")

    # Order matters: the last added is the outermost. CORS must wrap our middleware so preflights and error responses carry CORS headers.
    app.add_middleware(RequestContextMiddleware, max_body_bytes=settings.max_request_bytes, hsts=settings.is_production, metrics_enabled=settings.metrics_enabled)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                       allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"], expose_headers=["X-Request-ID", "X-Total-Count", "Content-Disposition", "Idempotent-Replayed"])
    register_error_handlers(app)

    app.include_router(health.router)
    app.include_router(auth_router.public)
    app.include_router(auth_router.protected)
    # platform + feature modules: routers (guarded by each module's feature flag), menu, flags
    registry.register_modules((PLATFORM, *INSTALLED_MODULES))
    registry.mount(app)

    setup_tracing(app, get_database().engine, settings) if settings.otlp_endpoint else None
    return app


app = create_app()
