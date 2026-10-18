from typing import List, Union
from uuid import UUID

from fastapi import Depends, Query, Response, status
from pydantic import BaseModel, Field

from app.foundation.db.pagination import PageParams
from app.foundation.security import permissions
from app.foundation.security.deps import require, secure_router
from app.modules.form_builder.schemas.form_template_create_schema import FormTemplateCreate
from app.modules.form_builder.schemas.form_template_fetch_schema import FormTemplateResponse, PublishedForm
from app.modules.form_builder.schemas.form_template_update_schema import FormTemplateUpdate
from app.modules.form_builder.services.form_service import FormService, get_form_service

permissions.register("template")
# publish = make the working copy the form people fill in; approve = decide on a publish when approvals are required
permissions.register("template", ["publish", "approve"])
permissions.define_role("editor", [*permissions.grants_for({"editor"}), "template:publish"])

router = secure_router(prefix="/forms", tags=["forms"])


class FormTemplateEnvelope(BaseModel):
    """The builder posts `{ template_data: {...} }`; a bare template body is accepted too."""

    template_data: FormTemplateCreate


@router.post("/templates", response_model=FormTemplateResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require("template:create"))])
async def create_form_template(body: Union[FormTemplateEnvelope, FormTemplateCreate], svc: FormService = Depends(get_form_service)):
    data = body.template_data if isinstance(body, FormTemplateEnvelope) else body
    return await svc.create(data.model_dump())


@router.get("/templates", response_model=List[FormTemplateResponse], dependencies=[Depends(require("template:read"))])
async def get_all_templates(response: Response, skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500), svc: FormService = Depends(get_form_service)):
    page_size = limit
    page = await svc.list(PageParams(page=skip // page_size + 1, page_size=page_size))
    response.headers["X-Total-Count"] = str(page.total)
    return page.items


@router.get("/templates/{template_id}", response_model=FormTemplateResponse, dependencies=[Depends(require("template:read"))])
async def get_template(template_id: UUID, svc: FormService = Depends(get_form_service)):
    return await svc.get(template_id)


@router.put("/templates/{template_id}", response_model=FormTemplateResponse, dependencies=[Depends(require("template:update"))])
async def update_template(template_id: UUID, body: FormTemplateUpdate, svc: FormService = Depends(get_form_service)):
    data = body.model_dump(exclude_unset=True)
    return await svc.update(template_id, {k: v for k, v in data.items() if k != "row_version"}, expected_version=data.get("row_version"))


class PublishRequest(BaseModel):
    note: str | None = Field(None, max_length=2000, description="For the approver, when publishing needs approval")


@router.post("/templates/{template_id}/publish", response_model=FormTemplateResponse, dependencies=[Depends(require("template:publish"))],
             summary="Publish the working copy (at once, or after approval when forms.require_approval is on)")
async def publish_template(template_id: UUID, body: PublishRequest | None = None, svc: FormService = Depends(get_form_service)):
    return await svc.publish(template_id, note=body.note if body else None)


@router.get("/templates/{template_id}/published", response_model=PublishedForm, dependencies=[Depends(require("template:read"))],
            summary="The form people fill in (409 form_not_published when there is none yet)")
async def get_published(template_id: UUID, svc: FormService = Depends(get_form_service)):
    template, version = await svc.published(template_id)
    return PublishedForm(template_id=template.id, name=template.name, version=template.version, version_id=version.id, published_at=template.published_at,
                         form_config=version.form_config, file_relations=template.file_relations)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require("template:delete"))])
async def delete_template(template_id: UUID, svc: FormService = Depends(get_form_service)):
    await svc.delete(template_id)
    return Response(status_code=204)
