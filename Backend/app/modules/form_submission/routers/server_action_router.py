from fastapi import Depends
from pydantic import BaseModel

from app.foundation.security.deps import require, secure_router
from app.modules.form_submission.services import server_actions

router = secure_router(prefix="/server-actions", tags=["Form Submissions"])


class ServerActionField(BaseModel):
    id: str
    required: bool
    description: str | None = None


class ServerActionInfo(BaseModel):
    key: str
    title: str
    description: str
    fields: list[ServerActionField]


@router.get("", response_model=list[ServerActionInfo], summary="Server actions a form can run on submit (for the form builder)",
            dependencies=[Depends(require("template:read"))])
async def list_server_actions():
    return [ServerActionInfo(key=a.key, title=a.title, description=a.description, fields=a.fields()) for a in server_actions.actions()]
