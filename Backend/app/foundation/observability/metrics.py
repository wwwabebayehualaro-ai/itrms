"""Prometheus metrics. Labels use the route *template* (never raw paths) to keep cardinality bounded."""
from __future__ import annotations

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest

registry = CollectorRegistry()
HTTP_REQUESTS = Counter("http_requests_total", "HTTP requests", ["method", "route", "status"], registry=registry)
HTTP_LATENCY = Histogram("http_request_duration_seconds", "HTTP request latency", ["method", "route"], registry=registry, buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10))
HTTP_INFLIGHT = Gauge("http_requests_in_flight", "In-flight requests", registry=registry)
AUTH_EVENTS = Counter("auth_events_total", "Authentication events", ["event"], registry=registry)
AUDIT_EVENTS = Counter("audit_events_total", "Audit records written", ["action"], registry=registry)


def render() -> tuple[bytes, str]:
    return generate_latest(registry), CONTENT_TYPE_LATEST
