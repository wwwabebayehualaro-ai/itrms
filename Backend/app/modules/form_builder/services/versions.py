"""Form versions: immutable snapshots of a template's content. The published one is what people fill in."""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.form_builder.models.FormTemplate import FormTemplate
from app.modules.form_builder.models.TemplateVersion import TemplateVersion


def content_hash(form_config: Any) -> str:
    return hashlib.sha256(json.dumps(form_config, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode()).hexdigest()


async def snapshot(session: AsyncSession, template: FormTemplate, *, flush: bool = True) -> TemplateVersion:
    """The stored version of the template's current content (created the first time that content is snapshotted).
    `flush=False` (inside `session.no_autoflush`) adds it to the caller's pending changes instead: one flush for both."""
    digest = content_hash(template.form_config)
    version = None
    if template.id is not None:
        stmt = select(TemplateVersion).where(TemplateVersion.template_id == template.id, TemplateVersion.content_hash == digest)
        version = (await session.execute(stmt)).scalars().first()
    if version is None:
        version = TemplateVersion(id=uuid.uuid4(), template_id=template.id, content_hash=digest, form_config=template.form_config)
        session.add(version)
        if flush:
            await session.flush()
    return version


async def get_version(session: AsyncSession, version_id) -> TemplateVersion | None:
    if version_id is None:
        return None
    return (await session.execute(select(TemplateVersion).where(TemplateVersion.id == version_id))).scalars().first()


async def live_config(session: AsyncSession, template: FormTemplate) -> Any:
    """The content people fill in: the published version, or the working copy of a form that was never published."""
    version = await get_version(session, template.published_version_id)
    return version.form_config if version is not None else template.form_config
