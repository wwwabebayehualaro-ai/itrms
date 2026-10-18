"""Optional OpenTelemetry tracing. Enabled only when OTLP_ENDPOINT is set and the OTel packages are installed."""
from __future__ import annotations

import logging

log = logging.getLogger("app.tracing")


def setup_tracing(app, engine, settings) -> None:
    if not settings.otlp_endpoint:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        log.warning("OTLP_ENDPOINT is set but OpenTelemetry packages are not installed; tracing disabled")
        return
    provider = TracerProvider(resource=Resource.create({"service.name": settings.service_name, "deployment.environment": settings.env}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.otlp_endpoint)))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
    SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
