from __future__ import annotations

from decimal import Decimal
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class CoreBankingSettings(BaseSettings):
    """Settings of this module (environment variables CORE_BANKING_*)."""

    model_config = SettingsConfigDict(env_prefix="CORE_BANKING_", env_file=(".env", "app/.env"), extra="ignore")

    #: a cash transaction above this amount (in the account's currency) waits for a supervisor's approval
    approval_limit: Decimal = Decimal("100000")


@lru_cache(maxsize=1)
def get_core_banking_settings() -> CoreBankingSettings:
    return CoreBankingSettings()
