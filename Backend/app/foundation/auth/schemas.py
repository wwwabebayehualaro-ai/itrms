from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    full_name: str | None = None
    roles: list[str]
    is_active: bool
    last_login_at: datetime | None = None
    created_at: datetime
    # effective permissions ("resource:action") of the caller; only filled by GET /auth/me so a UI can hide what the user may not do
    permissions: list[str] = Field(default_factory=list)


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(max_length=256)
    full_name: str | None = Field(default=None, max_length=255)
    roles: list[str] = Field(default_factory=lambda: ["viewer"])

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class DirectoryEntry(BaseModel):
    """Minimal, non-sensitive view of a colleague, for people pickers (no roles, no login state)."""

    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    full_name: str | None = None
