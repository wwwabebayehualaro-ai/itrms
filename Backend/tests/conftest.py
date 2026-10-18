"""Test harness. Runs against SQLite by default; set TEST_DATABASE_URL=postgresql+asyncpg://... to run on PostgreSQL."""
import os
import shutil
import tempfile

_TMP = tempfile.mkdtemp(prefix="dfc-test-")
os.environ.setdefault("ENV", "test")
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"
os.environ["UPLOAD_DIR"] = os.path.join(_TMP, "uploads")
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite+aiosqlite:///{_TMP}/test.db"
os.environ["METRICS_ENABLED"] = "true"
for var in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"):
    os.environ.pop(var, None)

import asyncio  # noqa: E402

import pytest  # noqa: E402
from alembic import command as alembic_command  # noqa: E402
from alembic.config import Config  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.cli import create_tenant  # noqa: E402
from app.foundation.config import get_settings  # noqa: E402
from app.foundation.db.base import Base  # noqa: E402
from app.foundation.db.session import Database, set_database  # noqa: E402
from app.main import create_app  # noqa: E402

PASSWORD = "Sup3rSecret-Passw0rd"


def _alembic_cfg() -> Config:
    return Config(os.path.join(os.path.dirname(os.path.dirname(__file__)), "alembic.ini"))


@pytest_asyncio.fixture
async def db():
    database = Database(get_settings())
    set_database(database)
    if database.engine.dialect.name == "postgresql":
        # On PostgreSQL the schema is built by the real migrations (RLS policies, audit trigger included).
        async with database.engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await asyncio.to_thread(alembic_command.upgrade, _alembic_cfg(), "head")
    else:
        async with database.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield database
    if database.engine.dialect.name != "postgresql":
        async with database.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
    await database.dispose()
    set_database(None)


@pytest_asyncio.fixture
async def client(db):
    from app.foundation.security.ratelimit import RateLimiter  # noqa: F401
    import app.foundation.auth.router as auth_router

    auth_router._login_limiter.reset()
    app = create_app()

    @app.get("/__boom")
    async def boom():  # exercises the unhandled-exception path
        raise RuntimeError("secret-internal-detail")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _seed(db, slug, email):
    async with db.sessionmaker() as s:
        tenant, user = await create_tenant(s, name=slug.title(), slug=slug, admin_email=email, admin_password=PASSWORD)
    return tenant, user


async def _login(client, email, password=PASSWORD):
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


@pytest_asyncio.fixture
async def acme(db, client):
    tenant, user = await _seed(db, "acme", "admin@acme-corp.org")
    tokens = await _login(client, "admin@acme-corp.org")
    return {"tenant": tenant, "user": user, "tokens": tokens, "h": {"Authorization": f"Bearer {tokens['access_token']}"}}


@pytest_asyncio.fixture
async def globex(db, client):
    tenant, user = await _seed(db, "globex", "admin@globex-corp.org")
    tokens = await _login(client, "admin@globex-corp.org")
    return {"tenant": tenant, "user": user, "tokens": tokens, "h": {"Authorization": f"Bearer {tokens['access_token']}"}}


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP, ignore_errors=True)


TEMPLATE = {"name": "Customer Intake", "form_config": {"fields": [{"id": "name", "type": "InputText"}]}, "file_relations": []}
