from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.foundation.errors import ValidationFailed

_hasher = PasswordHasher()  # argon2id, library defaults (RFC 9106 low-memory profile)
# Verified against when the account does not exist so timing does not reveal which emails are registered.
_DUMMY_HASH = _hasher.hash("timing-equalisation")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def validate_password_strength(password: str, min_length: int, *, email: str | None = None) -> None:
    problems = []
    if len(password) < min_length:
        problems.append(f"at least {min_length} characters")
    if password.lower() == password or password.upper() == password:
        problems.append("a mix of upper and lower case letters")
    if not any(c.isdigit() for c in password):
        problems.append("at least one digit")
    if email and email.split("@")[0].lower() in password.lower():
        problems.append("must not contain your email name")
    if problems:
        raise ValidationFailed("Password is too weak: " + "; ".join(problems), code="weak_password")
