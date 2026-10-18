from uuid import UUID

from fastapi import Depends, Response, status

from app.foundation.security import permissions
from app.foundation.security.deps import require, secure_router
from app.modules.form_submission.schemas.saved_view_schema import SavedViewCreate, SavedViewOut, SavedViewUpdate
from app.modules.form_submission.services.saved_view_service import SavedViewService, get_saved_view_service

# own views need no more than the right to work with requests; sharing a view or making it the default needs `template:update` (checked in the service)
permissions.register("view")

router = secure_router(prefix="/views", tags=["Saved views"])


@router.get("", response_model=list[SavedViewOut], summary="Views of a form: shared ones and your own", dependencies=[Depends(require("submission:read"))])
async def list_views(template_id: UUID, svc: SavedViewService = Depends(get_saved_view_service)):
    return await svc.list_views(template_id)


@router.post("", response_model=SavedViewOut, status_code=status.HTTP_201_CREATED, summary="Save a view", dependencies=[Depends(require("view:create"))])
async def create_view(body: SavedViewCreate, svc: SavedViewService = Depends(get_saved_view_service)):
    return await svc.create_view(body)


@router.patch("/{view_id}", response_model=SavedViewOut, summary="Change a view", dependencies=[Depends(require("view:update"))])
async def update_view(view_id: UUID, body: SavedViewUpdate, svc: SavedViewService = Depends(get_saved_view_service)):
    return await svc.update_view(view_id, body)


@router.delete("/{view_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a view", dependencies=[Depends(require("view:update"))])
async def delete_view(view_id: UUID, svc: SavedViewService = Depends(get_saved_view_service)):
    await svc.delete_view(view_id)
    return Response(status_code=204)
