/**
 * Keycloak's back-channel logout (OpenID Connect Back-Channel Logout 1.0, security.md SEC-SE-4): a signed logout token
 * naming the Keycloak session (`sid`) or the person (`sub`) whose sessions end. Checked like an ID token, plus the logout
 * rules: the back-channel event, no nonce, and each token used once.
 */
import { jwtVerify, type JWTVerifyGetKey } from 'jose';

const EVENT = 'http://schemas.openid.net/event/backchannel-logout';

export interface LogoutToken {
    jti: string;
    sid?: string;
    sub?: string;
}

export async function verifyLogoutToken(
    token: string,
    keys: JWTVerifyGetKey,
    expected: { issuer: string; clientId: string }
): Promise<LogoutToken | undefined> {
    try {
        const { payload } = await jwtVerify(token, keys, {
            issuer: expected.issuer,
            audience: expected.clientId,
            algorithms: ['RS256', 'PS256', 'ES256'],
            requiredClaims: ['iat', 'jti', 'events'],
            // a logout token is acted on at once: old ones are refused even without exp
            maxTokenAge: '5m',
            clockTolerance: 5
        });
        const events = payload.events;
        if (typeof events !== 'object' || events === null || !(EVENT in events)) return undefined;
        if ('nonce' in payload) return undefined;
        const sid = typeof payload.sid === 'string' ? payload.sid : undefined;
        const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
        if ((!sid && !sub) || typeof payload.jti !== 'string') return undefined;
        return { jti: payload.jti, sid, sub };
    } catch {
        return undefined;
    }
}
