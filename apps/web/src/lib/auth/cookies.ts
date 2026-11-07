// Cookie and field names shared by the BFF (server) and the browser (security.md SEC-SE-1, SEC-SE-6).

/** The opaque session id: HttpOnly, Secure, SameSite=Lax, Path=/. */
export const SESSION_COOKIE = '__Host-itrms_sid';
/** The CSRF token, readable by the page so it can send it back (double submit). */
export const CSRF_COOKIE = '__Host-itrms_csrf';
/** The sign-in in progress (PKCE verifier, state, nonce), sealed; lives ten minutes. */
export const LOGIN_COOKIE = '__Host-itrms_login';
/** Header and form field the CSRF token comes back in. */
export const CSRF_HEADER = 'x-csrf-token';
/**
 * Marks a read the app makes by itself (its polling every minute), not one the person made: it never restarts the
 * session's idle timeout, nor keeps Keycloak's session alive by a refresh (SEC-SE-2; security review 0.26c1 A1).
 */
export const BACKGROUND_HEADER = 'x-itrms-background';
export const CSRF_FIELD = 'csrf';
/** The person's language, readable by the server before it renders (not a secret; the preference itself is the API's). */
export const LANGUAGE_COOKIE = 'itrms_lang';
