"""Engine/session management and the FastAPI session dependency."""
from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.foundation.config import Settings, get_settings


class Database:
    def __init__(self, settings: Settings):
        url = settings.async_database_url
        kwargs: dict = {"echo": settings.db_echo, "pool_pre_ping": True}
        if url.startswith("postgresql"):
            kwargs.update(
                pool_size=settings.db_pool_size,
                max_overflow=settings.db_max_overflow,
                pool_recycle=settings.db_pool_recycle,
                connect_args={"timeout": 10, "command_timeout": settings.db_statement_timeout_ms / 1000},
            )
        self.engine: AsyncEngine = create_async_engine(url, **kwargs)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)

    async def dispose(self) -> None:
        await self.engine.dispose()


_db: Database | None = None


def get_database() -> Database:
    global _db
    if _db is None:
        _db = Database(get_settings())
    return _db


def set_database(db: Database | None) -> None:
    """Swap the process-wide database (tests, alternative bootstraps)."""
    global _db
    _db = db


async def get_session() -> AsyncIterator[AsyncSession]:
    """Request-scoped session. Services commit explicitly (before the response is sent); anything left open is rolled back."""
    async with get_database().sessionmaker() as session:
        try:
            yield session
        finally:
            await session.rollback()
