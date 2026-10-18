from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation.auth.models import RefreshToken, Tenant, User
from app.foundation import context
from app.foundation.audit.service import record_event
from app.foundation.config import Settings
from app.foundation.db.repository import CrudService, Repository
from app.foundation.errors import BadRequest, Unauthorized, ValidationFailed
from app.foundation.observability import metrics
from app.foundation.security import permissions
from app.foundation.security.passwords import hash_password, needs_rehash, validate_password_strength, verify_password
from app.foundation.security.principal import Principal
from app.foundation.security.tokens import TokenService

INVALID = "Invalid email or password"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt  # SQLite drops tz


class UserRepository(Repository[User]):
    model = User
    filterable = frozenset({"is_active", "email"})
    sortable = frozenset({"created_at", "email"})


class AuthService(CrudService[User]):
    repository_class = UserRepository

    def __init__(self, session: AsyncSession, tokens: TokenService, settings: Settings):
        super().__init__(session)
        self.tokens, self.s = tokens, settings

    # -- token issuing -----------------------------------------------------
    async def _issue(self, user: User, family: uuid.UUID | None = None) -> dict:
        principal = Principal(user.id, user.tenant_id, user.email, frozenset(user.roles or []))
        access, ttl = self.tokens.create_access(principal)
        refresh, claims = self.tokens.create_refresh(user.id, user.tenant_id, family or uuid.uuid4())
        self.session.add(RefreshToken(id=claims.jti, user_id=user.id, tenant_id=user.tenant_id, family_id=claims.family,
                                      expires_at=claims.expires_at, created_ip=context.client_ip_var.get()))
        return {"access_token": access, "refresh_token": refresh, "token_type": "bearer", "expires_in": ttl, "_jti": claims.jti}

    async def _tenant_active(self, tenant_id: uuid.UUID) -> bool:
        tenant = (await self.session.execute(select(Tenant).where(Tenant.id == tenant_id))).scalars().first()
        return bool(tenant and tenant.is_active)

    # -- flows ---------------------------------------------------------------
    async def login(self, email: str, password: str) -> dict:
        email = email.strip().lower()
        with context.system_context():
            user = (await self.session.execute(select(User).where(User.email == email, User.deleted_at.is_(None)))).scalars().first()
            ok = verify_password(password, user.password_hash if user else None)  # always run: constant-ish time
            now = _now()
            uid, tid = (user.id, user.tenant_id) if user else (None, None)  # read before commit/rollback expire the instance
            locked = bool(user and _aware(user.locked_until) and _aware(user.locked_until) > now)
            usable = bool(user and user.is_active and await self._tenant_active(user.tenant_id))

            if not (ok and usable and not locked):
                if user and not ok:
                    await self._count_failure(uid, now)
                await self.session.rollback()
                reason = "locked" if locked else "inactive" if (user and ok and not usable) else "bad_credentials"
                metrics.AUTH_EVENTS.labels("login_failure").inc()
                await record_event("auth.login", "user", str(uid) if uid else None, outcome="failure", changes={"reason": reason, "email": email},
                                   tenant_id=tid, actor_id=uid)
                raise Unauthorized(INVALID, code="invalid_credentials")

            # bookkeeping, not an edit of the account: atomic UPDATE outside the optimistic lock (parallel logins must not 409)
            values = {"failed_attempts": 0, "locked_until": None, "last_login_at": now}
            if needs_rehash(user.password_hash):
                values["password_hash"] = hash_password(password)
            pair = await self._issue(user)
            await self.session.execute(update(User).where(User.id == uid).values(**values).execution_options(synchronize_session=False))
            await self.session.commit()
        pair.pop("_jti")
        metrics.AUTH_EVENTS.labels("login_success").inc()
        await record_event("auth.login", "user", str(uid), tenant_id=tid, actor_id=uid)
        return pair

    async def _count_failure(self, user_id: uuid.UUID, now: datetime) -> None:
        """Count a wrong password atomically (parallel attempts are all counted); lock the account at the limit."""
        attempts = (await self.session.execute(
            update(User).where(User.id == user_id).values(failed_attempts=func.coalesce(User.failed_attempts, 0) + 1)
            .returning(User.failed_attempts).execution_options(synchronize_session=False))).scalar_one()
        if attempts >= self.s.login_max_failures:
            await self.session.execute(update(User).where(User.id == user_id, User.failed_attempts >= self.s.login_max_failures)
                                       .values(failed_attempts=0, locked_until=now + timedelta(minutes=self.s.login_lockout_minutes))
                                       .execution_options(synchronize_session=False))
        await self.session.commit()

    async def refresh(self, raw_token: str) -> dict:
        claims = self.tokens.decode_refresh(raw_token)
        with context.system_context():
            row = (await self.session.execute(select(RefreshToken).where(RefreshToken.id == claims.jti).with_for_update())).scalars().first()
            if row is None or _aware(row.expires_at) <= _now():
                raise Unauthorized("Invalid token", code="invalid_token")
            if row.revoked_at is not None:
                # A rotated token was replayed: assume theft and kill the whole session family.
                await self.session.execute(update(RefreshToken).where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=_now()))
                await self.session.commit()
                metrics.AUTH_EVENTS.labels("refresh_reuse").inc()
                await record_event("auth.refresh_reuse", "user", str(row.user_id), outcome="denied", tenant_id=row.tenant_id, actor_id=row.user_id)
                raise Unauthorized("Invalid token", code="invalid_token")
            user = (await self.session.execute(select(User).where(User.id == row.user_id, User.deleted_at.is_(None)))).scalars().first()
            if user is None or not user.is_active or not await self._tenant_active(user.tenant_id):
                raise Unauthorized("Invalid token", code="invalid_token")
            pair = await self._issue(user, family=row.family_id)  # picks up role changes made since the last refresh
            row.revoked_at, row.replaced_by = _now(), pair.pop("_jti")
            await self.session.commit()
        metrics.AUTH_EVENTS.labels("refresh").inc()
        return pair

    async def logout(self, raw_token: str) -> None:
        claims = self.tokens.decode_refresh(raw_token)
        with context.system_context():
            await self.session.execute(update(RefreshToken).where(RefreshToken.family_id == claims.family, RefreshToken.revoked_at.is_(None)).values(revoked_at=_now()))
            await self.session.commit()
        await record_event("auth.logout", "user", str(claims.user_id), tenant_id=claims.tenant_id, actor_id=claims.user_id)

    async def change_password(self, principal: Principal, current: str, new: str) -> None:
        user = await self.repo.get(principal.user_id)
        if not verify_password(current, user.password_hash):
            raise Unauthorized("Current password is incorrect", code="invalid_credentials")
        validate_password_strength(new, self.s.password_min_length, email=user.email)
        async with self.transaction():
            user.password_hash = hash_password(new)
            await self.session.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).values(revoked_at=_now()))
        await record_event("auth.password_changed", "user", str(user.id))

    async def directory(self, q: str | None, limit: int) -> list[User]:
        stmt = select(User).where(User.deleted_at.is_(None), User.is_active.is_(True))
        if q:
            like = f"%{q.strip().lower()}%"
            stmt = stmt.where(or_(func.lower(User.email).like(like), func.lower(func.coalesce(User.full_name, "")).like(like)))
        return list((await self.session.execute(stmt.order_by(func.lower(func.coalesce(User.full_name, User.email))).limit(limit))).scalars().all())

    async def create_user(self, *, email: str, password: str, full_name: str | None, roles: list[str]) -> User:
        unknown = set(roles) - permissions.known_roles()
        if unknown:
            raise ValidationFailed(f"Unknown role(s): {', '.join(sorted(unknown))}", code="unknown_role")
        if not roles:
            raise BadRequest("At least one role is required")
        validate_password_strength(password, self.s.password_min_length, email=email)
        return await self.create({"email": email.lower(), "password_hash": hash_password(password), "full_name": full_name, "roles": sorted(set(roles))})
