from __future__ import annotations

import uuid
from typing import Any, Mapping
from uuid import UUID

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation import approval
from app.foundation.approval.model import ApprovalRequest
from app.foundation.approval.service import ApprovalService
from app.foundation.db.base import utcnow
from app.foundation.db.repository import CrudService, Repository
from app.foundation.db.session import get_session
from app.foundation.errors import Conflict
from app.foundation.registry.service import FlagService
from app.modules.form_builder.models.FormTemplate import DRAFT, PENDING_APPROVAL, PUBLISHED, FormTemplate
from app.modules.form_builder.models.TemplateVersion import TemplateVersion
from app.modules.form_builder.services.versions import content_hash, get_version, snapshot
from app.modules.form_builder.services.form_config import check_form_config

#: feature flag: publishing a form needs a second person's approval (off: every save is published at once, as before)
REQUIRE_APPROVAL = "forms.require_approval"
PUBLISH_POLICY = "template.publish"


class TemplateRepository(Repository[FormTemplate]):
    model = FormTemplate
    resource_name = "Form template"
    filterable = frozenset({"category", "is_active", "slug", "status"})
    sortable = frozenset({"created_at", "updated_at", "name"})

    async def slug_exists(self, slug: str, *, exclude: UUID | None = None) -> bool:
        stmt = self._select().where(FormTemplate.slug == slug)
        if exclude:
            stmt = stmt.where(FormTemplate.id != exclude)
        return (await self.session.execute(stmt.limit(1))).first() is not None


async def _status_after(session: AsyncSession, template: FormTemplate, *, pending: bool) -> str:
    """draft / pending_approval / published, from what is published and whether a publish waits for approval."""
    if pending:
        return PENDING_APPROVAL
    published = await get_version(session, template.published_version_id)
    return PUBLISHED if published is not None and published.content_hash == content_hash(template.form_config) else DRAFT


def _set_published(template: FormTemplate, version: TemplateVersion) -> None:
    """Make `version` the form people fill in (no flush: lands in the caller's pending changes)."""
    template.published_version_id = version.id
    template.published_at = utcnow()
    template.status = PUBLISHED if version.content_hash == content_hash(template.form_config) else DRAFT


class FormService(CrudService[FormTemplate]):
    repository_class = TemplateRepository
    repo: TemplateRepository

    async def _ensure_slug_free(self, slug: str, exclude: UUID | None = None) -> None:
        if await self.repo.slug_exists(slug, exclude=exclude):
            raise Conflict("A template with this slug already exists", code="slug_taken")

    async def _approval_required(self) -> bool:
        return await FlagService(self.session).is_enabled(REQUIRE_APPROVAL)

    async def _after_save(self, template: FormTemplate) -> None:
        """Set the publish state of a template being saved; called with autoflush off so the save and its publish state are
        one INSERT/UPDATE (one audit entry, one row_version step). Without the approval flag every save is published at once
        (people always fill in the latest form, as before approvals existed)."""
        if not await self._approval_required():
            _set_published(template, await snapshot(self.session, template, flush=False))
            return
        pending = await ApprovalService(self.session).pending_for(PUBLISH_POLICY, str(template.id)) is not None
        published = await get_version(self.session, template.published_version_id)
        template.status = PENDING_APPROVAL if pending else PUBLISHED if published and published.content_hash == content_hash(template.form_config) else DRAFT

    async def create(self, data: Mapping[str, Any]) -> FormTemplate:
        check_form_config(data.get("form_config", {"fields": []}))
        await self._ensure_slug_free(data["slug"])
        async with self.transaction():
            with self.session.no_autoflush:
                template = await self.repo.add({**data, "id": uuid.uuid4(), "status": DRAFT}, flush=False)
                await self._after_save(template)
            await self.session.flush()
        await self.session.refresh(template)
        return template

    async def update(self, id: UUID, data: Mapping[str, Any], *, expected_version: int | None = None) -> FormTemplate:
        if data.get("form_config") is not None:
            check_form_config(data["form_config"])
        if data.get("slug"):
            await self._ensure_slug_free(data["slug"], exclude=id)
        data = {k: v for k, v in data.items() if k not in ("status", "published_version_id", "published_at")}
        async with self.transaction():
            template = await self.repo.get(id, for_update=True)
            with self.session.no_autoflush:
                await self.repo.update(template, data, expected_version=expected_version, flush=False)
                await self._after_save(template)
            await self.session.flush()
        await self.session.refresh(template)
        return template

    async def publish(self, id: UUID, *, note: str | None = None) -> FormTemplate:
        """Publish the working copy: at once, or (flag `forms.require_approval`) once a second person approves it."""
        async with self.transaction():
            template = await self.repo.get(id, for_update=True)
            version = await snapshot(self.session, template)
            if template.published_version_id == version.id:
                raise Conflict("This version of the form is already published", code="nothing_to_publish")
            if not await self._approval_required():
                _set_published(template, version)
                await self.session.flush()
            else:
                approvals = ApprovalService(self.session)
                if await approvals.pending_for(PUBLISH_POLICY, str(template.id)) is not None:
                    raise Conflict("Publishing this form already waits for approval", code="approval_pending")
                await approvals.submit(PUBLISH_POLICY, resource_type="form_templates", resource_id=str(template.id), title=f"Publish “{template.name}”",
                                       note=note, payload={"form": template.name, "version": template.version, "version_id": str(version.id)})
                template.status = PENDING_APPROVAL
                await self.session.flush()
        await self.session.refresh(template)
        return template

    async def published(self, id: UUID) -> tuple[FormTemplate, TemplateVersion]:
        template = await self.repo.get(id)
        version = await get_version(self.session, template.published_version_id)
        if version is None:
            raise Conflict("This form has not been published yet", code="form_not_published")
        return template, version


# -- approval policy: the decision's effect runs in the decision's transaction ------------------------------------------
async def _on_publish_approved(session: AsyncSession, request: ApprovalRequest) -> None:
    template = await TemplateRepository(session).get_or_none(UUID(request.resource_id), for_update=True)
    if template is None:
        raise Conflict("The form was deleted; withdraw this request", code="form_deleted")
    version = await get_version(session, UUID((request.payload or {})["version_id"]))
    if version is None or version.template_id != template.id:
        raise Conflict("The version to publish no longer exists", code="version_missing")
    _set_published(template, version)
    await session.flush()


async def _on_publish_closed(session: AsyncSession, request: ApprovalRequest) -> None:
    template = await TemplateRepository(session).get_or_none(UUID(request.resource_id), for_update=True)
    if template is not None:
        template.status = await _status_after(session, template, pending=False)
        await session.flush()


approval.register_policy(PUBLISH_POLICY, title="Publish a form", approver_permission="template:approve",
                         on_approved=_on_publish_approved, on_rejected=_on_publish_closed, on_cancelled=_on_publish_closed)


async def get_form_service(session: AsyncSession = Depends(get_session)) -> FormService:
    return FormService(session)
