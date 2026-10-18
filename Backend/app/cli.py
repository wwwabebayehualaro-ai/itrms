"""Operator commands (run from Backend/):

    python -m app.cli create-tenant --name "Acme" --slug acme --admin-email admin@acme.com   # password from ADMIN_PASSWORD or prompt
    python -m app.cli init-db                                                              # dev/test only: create_all instead of alembic
    python -m app.cli export-openapi [--check]                                             # write/verify contracts/openapi.json
    python -m app.cli purge-idempotency                                                    # delete expired idempotency records (schedule daily)
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys

from sqlalchemy import select

import app.models  # noqa: F401
from app.foundation.auth.models import Tenant, User
from app.foundation.auth.service import AuthService
from app.foundation import context
from app.foundation.config import get_settings
from app.foundation.db.base import Base
from app.foundation.db.events import install_session_hooks
from app.foundation.db.session import get_database
from app.foundation.security.deps import get_token_service


async def create_tenant(session, *, name: str, slug: str, admin_email: str, admin_password: str, admin_name: str | None = None) -> tuple[Tenant, User]:
    settings = get_settings()
    with context.system_context():
        tenant = (await session.execute(select(Tenant).where(Tenant.slug == slug))).scalars().first()
        if tenant is None:
            tenant = Tenant(name=name, slug=slug)
            session.add(tenant)
            await session.commit()
    with context.as_actor(tenant.id, None):
        svc = AuthService(session, get_token_service(), settings)
        user = await svc.create_user(email=admin_email, password=admin_password, full_name=admin_name, roles=["admin"])
    return tenant, user


async def _run(args) -> int:
    install_session_hooks()
    db = get_database()
    try:
        if args.command == "init-db":
            if get_settings().is_production:
                print("init-db is disabled in production; use `alembic upgrade head`", file=sys.stderr)
                return 2
            async with db.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            print("tables created")
        elif args.command == "create-tenant":
            password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
            async with db.sessionmaker() as session:
                tenant, user = await create_tenant(session, name=args.name, slug=args.slug, admin_email=args.admin_email, admin_password=password, admin_name=args.admin_name)
            print(f"tenant {tenant.slug} ({tenant.id}) ready; admin {user.email}")
        elif args.command == "purge-idempotency":
            from app.foundation.idempotency import purge_expired

            print(f"{await purge_expired()} expired idempotency records deleted")
        return 0
    finally:
        await db.dispose()


def export_openapi(check: bool) -> int:
    """No database needed: the contract is derived from the routes and schemas."""
    from app.foundation.api import contract
    from app.main import create_app

    app = create_app()
    if check:
        if contract.is_current(app):
            print(f"{contract.DEFAULT_PATH} is current")
            return 0
        print(f"{contract.DEFAULT_PATH} is out of date: run `python -m app.cli export-openapi`", file=sys.stderr)
        return 1
    print(f"{contract.DEFAULT_PATH} {'updated' if contract.write(app) else 'unchanged'}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init-db")
    sub.add_parser("purge-idempotency")
    sub.add_parser("export-openapi").add_argument("--check", action="store_true", help="fail when contracts/openapi.json is out of date")
    ct = sub.add_parser("create-tenant")
    ct.add_argument("--name", required=True)
    ct.add_argument("--slug", required=True)
    ct.add_argument("--admin-email", required=True)
    ct.add_argument("--admin-name")
    args = parser.parse_args()
    if args.command == "export-openapi":
        sys.exit(export_openapi(args.check))
    sys.exit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
