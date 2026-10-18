"""Async Alembic environment wired to the application's settings and metadata."""
import asyncio

from alembic import context
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

import app.models  # noqa: F401  (register all models)
from app.foundation.config import get_settings
from app.foundation.db.base import Base

target_metadata = Base.metadata


def _url() -> str:
    return get_settings().async_database_url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection) -> None:
    if connection.dialect.name == "postgresql":
        # Migrations are trusted system code: they must see every tenant's rows.
        connection.execute(text("SELECT set_config('app.bypass_rls', 'on', false)"))
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_async() -> None:
    engine = create_async_engine(_url())
    async with engine.connect() as conn:
        await conn.run_sync(_do_run)
        await conn.commit()
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async())
