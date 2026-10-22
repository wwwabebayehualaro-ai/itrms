// Injection tokens of the kernel's providers (symbols: no two modules can collide on a name).
export const LOGGER = Symbol('kernel.logger');
export const KERNEL_CONFIG = Symbol('kernel.config');
/** The process's Database (`@itrms/kernel/db`): slices inject it to open `scoped` transactions. */
export const DATABASE = Symbol('kernel.database');
/** The process's FieldCrypto (@itrms/kernel/crypto): from FIELD_KEYS and BLIND_INDEX_KEY. */
export const FIELD_CRYPTO = Symbol('kernel.field-crypto');
