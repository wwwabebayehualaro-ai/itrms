// Injection tokens of the kernel's providers (symbols: no two modules can collide on a name).
export const LOGGER = Symbol('kernel.logger');
export const KERNEL_CONFIG = Symbol('kernel.config');
