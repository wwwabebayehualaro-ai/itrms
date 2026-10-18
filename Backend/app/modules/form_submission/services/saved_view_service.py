from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import Depends
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation.auth.models import User
from app.foundation import context
from app.foundation.db.pagination import PageParams
from app.foundation.db.repository import CrudService, Repository
from app.foundation.db.session import get_session
from app.foundation.errors import Forbidden, NotFound
from app.foundation.security.deps import get_principal
from app.foundation.security.principal import Principal
from app.modules.form_submission.models.SavedView import SavedView
from app.modules.form_submission.schemas.saved_view_schema import SavedViewCreate, SavedViewOut, SavedViewUpdate
from app.modules.form_builder.services.form_service import TemplateRepository

MAX_VIEWS_PER_FORM = 200


class SavedViewRepository(Repository[SavedView]):
    model = SavedView
    resource_name = "View"
    filterable = frozenset({"template_id"})
    sortable = frozenset({"created_at", "name"})
    default_sort = "name"


class SavedViewService(CrudService[SavedView]):
    repository_class = SavedViewRepository

    def __init__(self, session: AsyncSession, principal: Principal):
        super().__init__(session)
        self.me = principal

    # -- rules ------------------------------------------------------------------------------------------------------
    def _is_owner(self, view: SavedView) -> bool:
        return view.created_by == self.me.user_id

    def _can_edit(self, view: SavedView) -> bool:
        """Private views: their owner. Shared views: anyone who may change the form itself (they affect everybody)."""
        return self.me.can("template:update") if view.visibility == "shared" else self._is_owner(view)

    def _visible(self, view: SavedView) -> bool:
        return view.visibility == "shared" or self._is_owner(view)

    async def _load(self, view_id: UUID, *, for_update: bool = False) -> SavedView:
        view = await self.repo.get(view_id, for_update=for_update)
        if not self._visible(view):
            raise NotFound("View not found")  # someone else's private view does not exist for you
        return view

    async def _out(self, views: list[SavedView]) -> list[SavedViewOut]:
        ids = {v.created_by for v in views if v.created_by}
        names = {}
        if ids:
            names = {i: (n or e) for i, n, e in (await self.session.execute(select(User.id, User.full_name, User.email).where(User.id.in_(ids)))).all()}
        return [SavedViewOut(id=v.id, template_id=v.template_id, name=v.name, visibility=v.visibility, is_default=v.is_default, config=v.config, created_by=v.created_by,
                             owner_name=names.get(v.created_by), created_at=v.created_at, updated_at=v.updated_at, row_version=v.row_version, can_edit=self._can_edit(v)) for v in views]

    async def _clear_default(self, template_id: UUID, except_id: UUID | None = None) -> None:
        stmt = update(SavedView).where(SavedView.template_id == template_id, SavedView.is_default.is_(True), SavedView.deleted_at.is_(None))
        if except_id:
            stmt = stmt.where(SavedView.id != except_id)
        await self.session.execute(stmt.values(is_default=False))

    def _check_share(self, visibility: str, is_default: bool) -> None:
        if (visibility == "shared" or is_default) and not self.me.can("template:update"):
            raise Forbidden("Only form editors can share a view or make it the default")

    # -- use cases --------------------------------------------------------------------------------------------------
    async def list_views(self, template_id: UUID) -> list[SavedViewOut]:
        await self._ensure_template(template_id)
        stmt = select(SavedView).where(SavedView.template_id == template_id, SavedView.deleted_at.is_(None),
                                       or_(SavedView.visibility == "shared", SavedView.created_by == self.me.user_id)).order_by(SavedView.name).limit(MAX_VIEWS_PER_FORM)
        return await self._out(list((await self.session.execute(stmt)).scalars().all()))

    async def _ensure_template(self, template_id: UUID) -> None:
        if await TemplateRepository(self.session).get_or_none(template_id) is None:
            raise NotFound("Form template not found")

    async def create_view(self, body: SavedViewCreate) -> SavedViewOut:
        await self._ensure_template(body.template_id)
        is_default = body.is_default
        visibility = "shared" if is_default else body.visibility  # a default is by nature shared
        self._check_share(visibility, is_default)
        data: dict[str, Any] = {"template_id": body.template_id, "name": body.name, "visibility": visibility, "is_default": is_default, "config": body.config.model_dump(mode="json")}
        async with self.transaction():
            if is_default:
                await self._clear_default(body.template_id)
            view = await self.repo.add(data)
        await self.session.refresh(view)
        return (await self._out([view]))[0]

    async def update_view(self, view_id: UUID, body: SavedViewUpdate) -> SavedViewOut:
        async with self.transaction():
            view = await self._load(view_id, for_update=True)
            if not self._can_edit(view):
                raise Forbidden("You cannot change this view")
            changes = body.model_dump(exclude_unset=True, mode="json")
            visibility = changes.get("visibility", view.visibility)
            is_default = changes.get("is_default", view.is_default)
            if visibility == "private" and "is_default" not in changes:
                is_default = False  # making a default private takes it off the default slot
            if is_default:
                visibility = "shared"  # a default is by nature shared
            if visibility == "private":
                is_default = False
            if (visibility, is_default) != (view.visibility, view.is_default):
                self._check_share(visibility, is_default)
            changes.update({"visibility": visibility, "is_default": is_default})
            if is_default:
                await self._clear_default(view.template_id, except_id=view.id)
            await self.repo.update(view, changes)
        await self.session.refresh(view)
        return (await self._out([view]))[0]

    async def delete_view(self, view_id: UUID) -> None:
        async with self.transaction():
            view = await self._load(view_id, for_update=True)
            if not self._can_edit(view):
                raise Forbidden("You cannot delete this view")
            await self.repo.soft_delete(view)


async def get_saved_view_service(session: AsyncSession = Depends(get_session), principal: Principal = Depends(get_principal)) -> SavedViewService:
    return SavedViewService(session, principal)
