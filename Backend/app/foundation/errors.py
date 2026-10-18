"""One error model for the whole service.

Feature code raises `AppError` subclasses (never `HTTPException`, never a bare `except Exception`).
Handlers registered here turn everything into RFC 9457 `application/problem+json` and never leak internals.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm.exc import StaleDataError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.foundation.context import request_id_var

log = logging.getLogger("app.errors")
PROBLEM_JSON = "application/problem+json"


class AppError(Exception):
    status_code = 500
    code = "internal_error"
    title = "Internal server error"

    def __init__(self, detail: str | None = None, *, code: str | None = None, errors: list[dict[str, Any]] | None = None, headers: dict[str, str] | None = None):
        super().__init__(detail or self.title)
        self.detail = detail or self.title
        if code:
            self.code = code
        self.errors = errors
        self.headers = headers


class BadRequest(AppError):
    status_code, code, title = 400, "bad_request", "Bad request"


class Unauthorized(AppError):
    status_code, code, title = 401, "unauthorized", "Authentication required"

    def __init__(self, detail: str | None = None, **kw):
        kw.setdefault("headers", {"WWW-Authenticate": "Bearer"})
        super().__init__(detail, **kw)


class Forbidden(AppError):
    status_code, code, title = 403, "forbidden", "You do not have permission to perform this action"


class NotFound(AppError):
    status_code, code, title = 404, "not_found", "Resource not found"


class Conflict(AppError):
    status_code, code, title = 409, "conflict", "Conflict with the current state of the resource"


class ValidationFailed(AppError):
    status_code, code, title = 422, "validation_error", "Request validation failed"


class TooManyRequests(AppError):
    status_code, code, title = 429, "rate_limited", "Too many requests"


class PayloadTooLarge(AppError):
    status_code, code, title = 413, "payload_too_large", "Payload too large"


class UnsupportedMedia(AppError):
    status_code, code, title = 415, "unsupported_media_type", "Unsupported media type"


class ServiceUnavailable(AppError):
    status_code, code, title = 503, "service_unavailable", "Service temporarily unavailable"


def problem(status: int, code: str, title: str, detail: str, *, errors=None, headers=None) -> JSONResponse:
    body: dict[str, Any] = {"type": f"urn:problem:{code}", "title": title, "status": status, "detail": detail, "code": code, "trace_id": request_id_var.get()}
    if errors:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, media_type=PROBLEM_JSON, headers=headers)


def _field_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    out = []
    for e in exc.errors():
        loc = [str(p) for p in e.get("loc", ()) if p not in ("body", "query", "path")]
        out.append({"field": ".".join(loc), "message": e.get("msg", "invalid"), "type": e.get("type")})
    return out


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        level = logging.ERROR if exc.status_code >= 500 else logging.INFO
        log.log(level, "%s %s -> %s %s", request.method, request.url.path, exc.status_code, exc.code)
        return problem(exc.status_code, exc.code, exc.title, exc.detail, errors=exc.errors, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        return problem(422, "validation_error", "Request validation failed", "One or more fields are invalid", errors=_field_errors(exc))

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        titles = {404: "Resource not found", 405: "Method not allowed"}
        return problem(exc.status_code, f"http_{exc.status_code}", titles.get(exc.status_code, "HTTP error"), str(exc.detail), headers=getattr(exc, "headers", None))

    @app.exception_handler(StaleDataError)
    async def _stale(request: Request, exc: StaleDataError):
        return problem(409, "version_conflict", "Version conflict", "The resource was modified by someone else. Reload and retry.")

    @app.exception_handler(IntegrityError)
    async def _integrity(request: Request, exc: IntegrityError):
        # Constraint details stay in the logs, not in the response.
        log.warning("integrity error on %s %s: %s", request.method, request.url.path, exc.orig)
        return problem(409, "conflict", "Conflict", "The request conflicts with existing data (for example a duplicate value).")

    @app.exception_handler(OperationalError)
    async def _operational(request: Request, exc: OperationalError):
        log.error("database unavailable: %s", exc)
        return problem(503, "service_unavailable", "Service temporarily unavailable", "Please retry shortly.", headers={"Retry-After": "5"})

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return problem(500, "internal_error", "Internal server error", "An unexpected error occurred. Quote the trace_id when contacting support.")
