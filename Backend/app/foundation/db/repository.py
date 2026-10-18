"""Generic data access. Tenant scoping, soft delete, audit and actor stamping are handled by the session hooks and
mixins, so feature repositories/services only express business rules."""
from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Generic, TypeVar

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation.db.base import Base, SoftDeleteMixin, utcnow
from app.foundation.db.pagination import Page, PageParams
from app.foundation.errors import BadRequest, Conflict, NotFound
from app.foundation import context

M = TypeVar("M", bound=Base)


class Repository(Generic[M]):
    model: type[M]
    #: filter/sort keys a caller may use (whitelist - never build queries from raw user strings)
    filterable: frozenset[str] = frozenset()
    sortable: frozenset[str] = frozenset({"created_at", "updated_at"})
    default_sort: str = "-created_at"
    resource_name: str | None = None

    def __init__(self, session: AsyncSession):
        self.session = session

    # -- reads --------------------------------------------------------------
    def _select(self, include_deleted: bool = False):
        stmt = select(self.model)
        if issubclass(self.model, SoftDeleteMixin) and not include_deleted:
            stmt = stmt.where(self.model.deleted_at.is_(None))
        return stmt

    async def get_or_none(self, id: uuid.UUID, *, include_deleted: bool = False, for_update: bool = False) -> M | None:
        stmt = self._select(include_deleted).where(self.model.id == id)  # type: ignore[attr-defined]
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.session.execute(stmt)).scalars().first()

    async def get(self, id: uuid.UUID, **kw) -> M:
        obj = await self.get_or_none(id, **kw)
        if obj is None:
            raise NotFound(f"{self.resource_name or self.model.__tablename__} not found")
        return obj

    def _order(self, sort: str | None):
        sort = sort or self.default_sort
        desc = sort.startswith("-")
        key = sort.lstrip("-+")
        if key not in self.sortable:
            raise BadRequest(f"Cannot sort by '{key}'", code="invalid_sort")
        col = getattr(self.model, key)
        return col.desc() if desc else col.asc()

    async def list(self, *, params: PageParams, filters: Mapping[str, Any] | None = None, where: Sequence[ColumnElement] = (),
                   sort: str | None = None, include_deleted: bool = False) -> Page[M]:
        stmt = self._select(include_deleted)
        for key, value in (filters or {}).items():
            if value is None:
                continue
            if key not in self.filterable:
                raise BadRequest(f"Cannot filter by '{key}'", code="invalid_filter")
            stmt = stmt.where(getattr(self.model, key) == value)
        for clause in where:
            stmt = stmt.where(clause)
        total = (await self.session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
        rows = (await self.session.execute(stmt.order_by(self._order(sort), self.model.id).offset(params.offset).limit(params.page_size))).scalars().all()  # type: ignore[attr-defined]
        return Page(items=list(rows), total=total, page=params.page, page_size=params.page_size)

    # -- writes (flush only; the service owns the transaction) -----------------
    async def add(self, data: Mapping[str, Any], *, flush: bool = True) -> M:
        """`flush=False` lets the caller make further changes that land in the same INSERT (one audit entry, one version)."""
        obj = self.model(**data)
        self.session.add(obj)
        if flush:
            await self.session.flush()
        return obj

    async def update(self, obj: M, data: Mapping[str, Any], *, expected_version: int | None = None, flush: bool = True) -> M:
        if expected_version is not None and getattr(obj, "row_version", expected_version) != expected_version:
            raise Conflict("The resource was modified by someone else. Reload and retry.", code="version_conflict")
        for key, value in data.items():
            if key in ("id", "tenant_id", "created_by", "created_at", "row_version"):
                continue
            setattr(obj, key, value)
        if flush:
            await self.session.flush()
        return obj

    async def soft_delete(self, obj: M) -> None:
        if not isinstance(obj, SoftDeleteMixin):
            raise BadRequest("Resource does not support soft delete")
        obj.deleted_at = utcnow()
        obj.deleted_by = context.actor_id_var.get()
        await self.session.flush()


class CrudService(Generic[M]):
    """Base for feature services. Wraps a repository and owns the unit of work.

    Subclass, set `repository_class`, and add business rules. Use `async with self.transaction():` for multi-step writes.
    """

    repository_class: type[Repository[M]]

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = self.repository_class(session)

    @asynccontextmanager
    async def transaction(self):
        try:
            yield
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            raise

    async def get(self, id: uuid.UUID) -> M:
        return await self.repo.get(id)

    async def list(self, params: PageParams, filters: Mapping[str, Any] | None = None, sort: str | None = None, **kw) -> Page[M]:
        return await self.repo.list(params=params, filters=filters, sort=sort, **kw)

    async def create(self, data: Mapping[str, Any]) -> M:
        async with self.transaction():
            obj = await self.repo.add(data)
        await self.session.refresh(obj)
        return obj

    async def update(self, id: uuid.UUID, data: Mapping[str, Any], *, expected_version: int | None = None) -> M:
        async with self.transaction():
            obj = await self.repo.get(id, for_update=True)
            await self.repo.update(obj, data, expected_version=expected_version)
        await self.session.refresh(obj)
        return obj

    async def delete(self, id: uuid.UUID) -> None:
        async with self.transaction():
            obj = await self.repo.get(id, for_update=True)
            await self.repo.soft_delete(obj)
