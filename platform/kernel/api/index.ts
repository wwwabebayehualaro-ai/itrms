/**
 * Public entry of @itrms/kernel for API processes (code-structure.md §5.3). Subsystems have their own subpaths:
 * `@itrms/kernel/config`, `/errors`, `/context` (and `/db`, `/db/system` from task 0.7).
 */
export { KernelModule } from './kernel.module';
export { createHttpApp, createWorkerContext } from './bootstrap';
export { createLogger, maskSecrets, PinoNestLogger, REDACTED_PATHS, type Logger } from './observability/logger';
export { Metrics } from './observability/metrics';
export { HealthController, ReadinessRegistry, type ReadinessCheck } from './observability/health';
export { KERNEL_CONFIG, LOGGER } from './observability/tokens';
