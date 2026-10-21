/**
 * Process metrics in the Prometheus text format at `/metrics`, through the OpenTelemetry SDK (ADR-0023: Alloy scrapes it;
 * Nginx keeps the path internal). The HTTP process records every request: count and duration by method, route template
 * and status. Route templates, never raw paths, so ids do not become label values.
 */
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrometheusExporter, PrometheusSerializer } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

@Injectable()
export class Metrics implements OnApplicationShutdown {
    private readonly exporter = new PrometheusExporter({ preventServerStart: true });
    private readonly provider = new MeterProvider({ readers: [this.exporter] });
    private readonly serializer = new PrometheusSerializer();
    readonly meter = this.provider.getMeter('itrms-api');

    private readonly requests = this.meter.createCounter('http_server_requests', {
        description: 'HTTP requests served'
    });
    private readonly duration = this.meter.createHistogram('http_server_request_duration_seconds', {
        description: 'Time to serve an HTTP request',
        unit: 's'
    });

    /** One served request. `route` is the matched template (`/cases/:id`), or "unmatched". */
    recordRequest(method: string, route: string, status: number, seconds: number) {
        const attributes = { method, route, status: String(status) };
        this.requests.add(1, attributes);
        this.duration.record(seconds, attributes);
    }

    /** Everything collected so far, in the Prometheus text exposition format. */
    async render(): Promise<string> {
        const { resourceMetrics } = await this.exporter.collect();
        return this.serializer.serialize(resourceMetrics);
    }

    async onApplicationShutdown() {
        await this.provider.shutdown();
    }
}
