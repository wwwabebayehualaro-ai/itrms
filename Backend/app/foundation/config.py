"""Typed, validated settings. The only place environment variables are read."""
from __future__ import annotations

import secrets
import warnings
from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "app/.env"), extra="ignore", case_sensitive=False)

    # --- runtime -----------------------------------------------------------
    env: Literal["development", "test", "staging", "production"] = "development"
    service_name: str = "digital-file-cabinet"
    log_level: str = "INFO"

    # --- database ----------------------------------------------------------
    database_url: str | None = None  # full async URL; overrides the POSTGRES_* parts
    postgres_user: str | None = None
    postgres_password: SecretStr | None = None
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str | None = None
    db_pool_size: int = 10
    db_max_overflow: int = 10
    db_pool_recycle: int = 3600
    db_echo: bool = False
    db_statement_timeout_ms: int = 60_000

    # --- security ----------------------------------------------------------
    jwt_secret: SecretStr | None = None
    jwt_issuer: str = "digital-file-cabinet"
    jwt_audience: str = "digital-file-cabinet-api"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 7
    password_min_length: int = 12
    login_max_failures: int = 5
    login_lockout_minutes: int = 15
    # local defaults: the dev server (:3000) and the Playwright e2e server (:3100); set CORS_ORIGINS explicitly elsewhere
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://localhost:3100"])
    max_request_bytes: int = 12 * 1024 * 1024

    # --- files -------------------------------------------------------------
    upload_dir: str = "uploads"
    max_upload_bytes: int = 10 * 1024 * 1024
    allowed_upload_types: list[str] = Field(
        default_factory=lambda: ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/csv"]
    )

    # --- observability -----------------------------------------------------
    metrics_enabled: bool = True
    otlp_endpoint: str | None = None

    @field_validator("cors_origins", "allowed_upload_types", mode="before")
    @classmethod
    def _split_csv(cls, v):
        if isinstance(v, str) and not v.strip().startswith("["):
            return [p.strip() for p in v.split(",") if p.strip()]
        return v

    @model_validator(mode="after")
    def _validate(self) -> "Settings":
        if self.jwt_secret is None:
            if self.env in ("production", "staging"):
                raise ValueError("JWT_SECRET is required in production/staging")
            warnings.warn("JWT_SECRET not set: using an ephemeral secret (tokens die on restart)", stacklevel=2)
            self.jwt_secret = SecretStr(secrets.token_urlsafe(48))
        elif len(self.jwt_secret.get_secret_value()) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        if self.env == "production":
            if "*" in self.cors_origins:
                raise ValueError("CORS_ORIGINS must not contain '*' in production")
            if self.db_echo:
                raise ValueError("DB_ECHO must be off in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def async_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        missing = [n for n, v in (("POSTGRES_USER", self.postgres_user), ("POSTGRES_PASSWORD", self.postgres_password), ("POSTGRES_DB", self.postgres_db)) if not v]
        if missing:
            raise ValueError(f"Missing database configuration: {', '.join(missing)}")
        pw = quote_plus(self.postgres_password.get_secret_value())  # type: ignore[union-attr]
        return f"postgresql+asyncpg://{self.postgres_user}:{pw}@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
