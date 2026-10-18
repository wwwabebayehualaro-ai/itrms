"""Pure-ASGI request middleware: correlation id, client context, body limit, access log, metrics, security headers.

Written as ASGI (not BaseHTTPMiddleware) so contextvars propagate into the endpoint and the exception handlers.
It also converts unhandled exceptions to problem+json *inside* the context so `trace_id` is always present.
"""
from __future__ import annotations

import logging
import re
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.foundation import context
from app.foundation.errors import problem
from app.foundation.observability import metrics

log = logging.getLogger("app.access")
_RID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, *, max_body_bytes: int, hsts: bool = False, metrics_enabled: bool = True):
        self.app, self.max_body, self.hsts, self.metrics_enabled = app, max_body_bytes, hsts, metrics_enabled

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        headers = Headers(scope=scope)
        inbound = headers.get("x-request-id", "")
        rid = inbound if _RID.match(inbound) else uuid.uuid4().hex
        client = scope.get("client")
        forwarded = headers.get("x-forwarded-for", "").split(",")[0].strip()  # trust only behind a known proxy
        tokens = [
            context.request_id_var.set(rid),
            context.client_ip_var.set(forwarded or (client[0] if client else None)),
            context.user_agent_var.set((headers.get("user-agent") or "")[:300] or None),
            # start every request with no tenant/actor; auth sets them, and they cannot leak past the request
            context.tenant_id_var.set(None),
            context.actor_id_var.set(None),
            context.tenant_bypass_var.set(False),
        ]
        start, status_holder = time.perf_counter(), {"status": 500}
        if self.metrics_enabled:
            metrics.HTTP_INFLIGHT.inc()

        async def send_wrapper(message: Message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                h = MutableHeaders(scope=message)
                h["X-Request-ID"] = rid
                h["X-Content-Type-Options"] = "nosniff"
                h["X-Frame-Options"] = "DENY"
                h["Referrer-Policy"] = "no-referrer"
                h["Cache-Control"] = h.get("Cache-Control", "no-store")
                if self.hsts:
                    h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
            await send(message)

        try:
            length = headers.get("content-length")
            if length and length.isdigit() and int(length) > self.max_body:
                resp = problem(413, "payload_too_large", "Payload too large", f"Request body exceeds {self.max_body} bytes")
                return await resp(scope, receive, send_wrapper)
            try:
                await self.app(scope, receive, send_wrapper)
            except Exception:  # noqa: BLE001 - last line of defence, keeps trace_id in the response
                log.exception("unhandled error on %s %s", scope["method"], scope["path"])
                resp = problem(500, "internal_error", "Internal server error", "An unexpected error occurred. Quote the trace_id when contacting support.")
                await resp(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - start
            # full templated path (prefix included) for matched routes; unmatched paths share one label to bound cardinality
            route = _UUID.sub("{id}", scope["path"]) if scope.get("route") is not None else "unmatched"
            status = status_holder["status"]
            if self.metrics_enabled:
                metrics.HTTP_INFLIGHT.dec()
                metrics.HTTP_REQUESTS.labels(scope["method"], route, str(status)).inc()
                metrics.HTTP_LATENCY.labels(scope["method"], route).observe(elapsed)
            if route not in ("/healthz", "/readyz", "/metrics"):
                log.info("request", extra={"method": scope["method"], "path": scope["path"], "route": route, "status": status, "duration_ms": round(elapsed * 1000, 1), "client_ip": context.client_ip_var.get()})
            for var, tok in zip((context.request_id_var, context.client_ip_var, context.user_agent_var, context.tenant_id_var, context.actor_id_var, context.tenant_bypass_var), tokens):
                var.reset(tok)
