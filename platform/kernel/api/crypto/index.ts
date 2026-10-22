/**
 * @itrms/kernel/crypto: field encryption, blind indexes and the audited reveal (security.md §10–11). The only module that
 * calls cryptographic primitives for sensitive fields (SEC-CR-1); `FIELD_CRYPTO` is the process's instance.
 */
export { bytea, regionDataKeys } from './crypto.table';
export { CryptoUnavailableError, FieldCrypto, parseFieldKeys, type FieldCryptoKeys } from './field-crypto';
export { reveal, type RevealRequest } from './reveal';
export { FIELD_CRYPTO } from '../observability/tokens';
