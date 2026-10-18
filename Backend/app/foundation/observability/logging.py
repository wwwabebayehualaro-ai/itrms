"""Structured JSON logging to stdout (12-factor). Every line carries request/tenant/actor ids and is scrubbed of secrets."""
from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, timezone

from app.foundation import context

SENSITIVE_KEYS = {"password", "password_hash", "token", "access_token", "refresh_token", "secret", "api_key", "authorization", "cookie", "credit_card", "jwt_secret"}
_CARD = re.compile(r"\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b")
_BEARER = re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]+")
MASK = "****"


def mask(data, keys: set[str] = SENSITIVE_KEYS):
    """Recursively redact sensitive values in dicts/lists/strings."""
    if isinstance(data, dict):
        return {k: (MASK if str(k).lower() in keys else mask(v, keys)) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return [mask(v, keys) for v in data]
    if isinstance(data, str):
        return _BEARER.sub(f"Bearer {MASK}", _CARD.sub(MASK, data))
    return data


_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str, env: str):
        super().__init__()
        self.service, self.env = service, env

    def format(self, record: logging.LogRecord) -> str:
        ctx = context.current()
        entry = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": mask(record.getMessage()),
            "service": self.service,
            "env": self.env,
            "request_id": ctx.request_id,
            "tenant_id": str(ctx.tenant_id) if ctx.tenant_id else None,
            "actor_id": str(ctx.actor_id) if ctx.actor_id else None,
        }
        extra = {k: v for k, v in record.__dict__.items() if k not in _RESERVED and not k.startswith("_")}
        if extra:
            entry.update(mask(extra))
        if record.exc_info:
            entry["exc"] = mask(self.formatException(record.exc_info))
        return json.dumps({k: v for k, v in entry.items() if v is not None}, default=str)


def setup_logging(service: str, env: str, level: str = "INFO") -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service, env))
    root.addHandler(handler)
    root.setLevel(level.upper())
    for noisy in ("uvicorn.access", "sqlalchemy.engine"):  # replaced by our access log / opt-in echo
        logging.getLogger(noisy).setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").handlers.clear()
    logging.getLogger("uvicorn.error").propagate = True
