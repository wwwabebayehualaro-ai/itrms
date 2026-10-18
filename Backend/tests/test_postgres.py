"""PostgreSQL-only guarantees: row-level security, DB-enforced audit immutability, and migration of a pre-platform database."""
import asyncio
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.foundation.config import get_settings
from tests.conftest import TEMPLATE, _alembic_cfg
from alembic import command as alembic_command

pytestmark = pytest.mark.skipif(not get_settings().async_database_url.startswith("postgresql"), reason="needs PostgreSQL (TEST_DATABASE_URL)")


async def make_template(client, who, **over):
    r = await client.post("/template/forms/templates", headers=who["h"], json={**TEMPLATE, **over})
    assert r.status_code == 201, r.text


async def app_role_engine(db):
    """Engine connected as a NON-superuser (superusers bypass RLS)."""
    async with db.engine.begin() as c:
        await c.execute(text("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dfc_app') THEN CREATE ROLE dfc_app LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS; END IF; END $$"))
        await c.execute(text("GRANT USAGE ON SCHEMA public TO dfc_app"))
        await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dfc_app"))
    url = make_url(get_settings().async_database_url).set(username="dfc_app", password="pw")
    return create_async_engine(url)


async def test_rls_isolates_tenants_even_with_raw_sql(db, client, acme, globex):
    await make_template(client, acme)
    eng = await app_role_engine(db)
    try:
        async with eng.begin() as c:
            await c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(globex["tenant"].id)})
            assert (await c.execute(text("SELECT count(*) FROM form_templates"))).scalar() == 0
        async with eng.begin() as c:
            await c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(acme["tenant"].id)})
            assert (await c.execute(text("SELECT count(*) FROM form_templates"))).scalar() == 1
        async with eng.begin() as c:  # no tenant at all -> nothing
            assert (await c.execute(text("SELECT count(*) FROM form_templates"))).scalar() == 0
        async with eng.begin() as c:  # writing into another tenant is refused by WITH CHECK
            await c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(globex["tenant"].id)})
            with pytest.raises(Exception, match="row-level security"):
                await c.execute(text("INSERT INTO form_templates (id, tenant_id, name, slug, form_config, file_relations, version, is_active, row_version) "
                                     "VALUES (:i, :t, 'x', 'x', '{}', '[]', '1', true, 1)"), {"i": uuid.uuid4(), "t": acme["tenant"].id})
    finally:
        await eng.dispose()


async def test_audit_log_is_immutable_at_the_database(db, acme):
    async with db.engine.begin() as c:
        with pytest.raises(Exception, match="append-only"):
            await c.execute(text("UPDATE audit_logs SET action = 'x'"))
    async with db.engine.begin() as c:
        with pytest.raises(Exception, match="append-only"):
            await c.execute(text("DELETE FROM audit_logs"))


LEGACY_DDL = """
CREATE TABLE form_templates (
  id uuid PRIMARY KEY, name varchar(255) NOT NULL, slug varchar(255) UNIQUE NOT NULL, version varchar(50) NOT NULL DEFAULT '1.0.0',
  form_config jsonb NOT NULL, thumbnail_url varchar(512), category varchar(100), is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz, created_by uuid, file_relations jsonb NOT NULL);
CREATE TABLE form_submissions (
  id uuid PRIMARY KEY, template_id uuid NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE, submission_data jsonb NOT NULL,
  form_metadata jsonb, created_at timestamptz DEFAULT now(), files_uploaded jsonb, status varchar(63), version varchar(63),
  submitted_by uuid, updated_at time with time zone, deleted_at time with time zone, is_deleted boolean);
"""


async def test_migration_adopts_legacy_database_without_losing_data():
    settings = get_settings()
    eng = create_async_engine(settings.async_database_url)
    tid, live, dead = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    try:
        async with eng.begin() as c:
            await c.execute(text("DROP SCHEMA public CASCADE"))
            await c.execute(text("CREATE SCHEMA public"))
            for stmt in [s for s in LEGACY_DDL.split(";") if s.strip()]:
                await c.execute(text(stmt))
            await c.execute(text("INSERT INTO form_templates (id,name,slug,form_config,file_relations,created_by) VALUES (:i,'Old','old','{\"fields\":[]}','[]',:u)"), {"i": tid, "u": uuid.uuid4()})
            await c.execute(text("INSERT INTO form_submissions (id,template_id,submission_data,status,submitted_by,is_deleted) VALUES (:a,:t,'{}','submitted',:u,false),(:b,:t,'{}','draft',:u,true)"),
                            {"a": live, "b": dead, "t": tid, "u": uuid.uuid4()})
        await asyncio.to_thread(alembic_command.upgrade, _alembic_cfg(), "head")
        async with eng.begin() as c:
            await c.execute(text("SELECT set_config('app.bypass_rls','on',true)"))
            assert (await c.execute(text("SELECT slug FROM tenants"))).scalars().all() == ["default"]
            row = (await c.execute(text("SELECT name, tenant_id, row_version FROM form_templates"))).one()
            assert row.name == "Old" and row.tenant_id is not None and row.row_version == 1
            subs = {r.id: r for r in (await c.execute(text("SELECT id, tenant_id, deleted_at, created_by FROM form_submissions"))).all()}
            assert subs[live].deleted_at is None and subs[dead].deleted_at is not None  # is_deleted converted to soft delete
            assert subs[live].tenant_id == row.tenant_id and subs[live].created_by is not None
            cols = {r.column_name: r.data_type for r in (await c.execute(text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='form_submissions'"))).all()}
            assert "is_deleted" not in cols and cols["updated_at"].startswith("timestamp") and cols["deleted_at"].startswith("timestamp")
            # legacy global unique(slug) replaced by per-tenant uniqueness among live rows
            assert (await c.execute(text("SELECT count(*) FROM pg_indexes WHERE indexname='uq_form_templates_tenant_slug'"))).scalar() == 1
        with pytest.raises(NotImplementedError):
            await asyncio.to_thread(alembic_command.downgrade, _alembic_cfg(), "base")
    finally:
        async with eng.begin() as c:
            await c.execute(text("DROP SCHEMA public CASCADE"))
            await c.execute(text("CREATE SCHEMA public"))
        await eng.dispose()
