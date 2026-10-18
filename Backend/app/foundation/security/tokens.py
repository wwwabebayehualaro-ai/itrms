"""JWT access/refresh tokens (HS256). Access tokens are short-lived and stateless; refresh tokens are single-use
and tracked server-side (see auth.service) so they can be rotated and revoked."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt

from app.foundation.config import Settings
from app.foundation.errors import Unauthorized
from app.foundation.security.principal import Principal


@dataclass(frozen=True)
class RefreshClaims:
    jti: uuid.UUID
    family: uuid.UUID
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    expires_at: datetime


class TokenService:
    def __init__(self, settings: Settings):
        self.s = settings
        self._key = settings.jwt_secret.get_secret_value()  # type: ignore[union-attr]

    def _encode(self, claims: dict) -> str:
        return jwt.encode(claims, self._key, algorithm="HS256")

    def _base(self, typ: str, ttl: timedelta) -> dict:
        now = datetime.now(timezone.utc)
        return {"iss": self.s.jwt_issuer, "aud": self.s.jwt_audience, "iat": now, "nbf": now, "exp": now + ttl, "jti": str(uuid.uuid4()), "typ": typ}

    def create_access(self, p: Principal) -> tuple[str, int]:
        ttl = timedelta(minutes=self.s.access_token_ttl_minutes)
        claims = self._base("access", ttl) | {"sub": str(p.user_id), "tid": str(p.tenant_id), "email": p.email, "roles": sorted(p.roles)}
        return self._encode(claims), int(ttl.total_seconds())

    def create_refresh(self, user_id: uuid.UUID, tenant_id: uuid.UUID, family: uuid.UUID) -> tuple[str, RefreshClaims]:
        claims = self._base("refresh", timedelta(days=self.s.refresh_token_ttl_days)) | {"sub": str(user_id), "tid": str(tenant_id), "fam": str(family)}
        return self._encode(claims), RefreshClaims(uuid.UUID(claims["jti"]), family, user_id, tenant_id, claims["exp"])

    def _decode(self, token: str, typ: str) -> dict:
        try:
            claims = jwt.decode(token, self._key, algorithms=["HS256"], audience=self.s.jwt_audience, issuer=self.s.jwt_issuer,
                                options={"require": ["exp", "iat", "sub", "jti", "typ"]})
        except jwt.ExpiredSignatureError:
            raise Unauthorized("Token expired", code="token_expired") from None
        except jwt.PyJWTError:
            raise Unauthorized("Invalid token", code="invalid_token") from None
        if claims.get("typ") != typ:
            raise Unauthorized("Invalid token type", code="invalid_token")
        return claims

    def decode_access(self, token: str) -> Principal:
        c = self._decode(token, "access")
        try:
            return Principal(uuid.UUID(c["sub"]), uuid.UUID(c["tid"]), c.get("email", ""), frozenset(c.get("roles", [])))
        except (KeyError, ValueError):
            raise Unauthorized("Invalid token", code="invalid_token") from None

    def decode_refresh(self, token: str) -> RefreshClaims:
        c = self._decode(token, "refresh")
        try:
            return RefreshClaims(uuid.UUID(c["jti"]), uuid.UUID(c["fam"]), uuid.UUID(c["sub"]), uuid.UUID(c["tid"]),
                                 datetime.fromtimestamp(c["exp"], timezone.utc))
        except (KeyError, ValueError):
            raise Unauthorized("Invalid token", code="invalid_token") from None
