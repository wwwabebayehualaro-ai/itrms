from typing import Optional
from uuid import UUID

from fastapi import Body, Depends, Query, Response, status

from app.foundation.db.pagination import PageParams, page_params
from app.foundation.idempotency import Idempotency, idempotency
from app.foundation.security import permissions
from app.foundation.security.deps import get_principal, require, secure_router
from app.foundation.security.principal import Principal
from app.modules.form_submission.schemas.form_submission_create_schema import FormSubmissionCreate
from app.modules.form_submission.schemas.form_submission_fetch_schema import FormSubmissionResponse, PaginatedSubmissions, SubmissionQueryParams
from app.modules.form_submission.schemas.form_submission_update_schema import FormSubmissionStatusUpdate, FormSubmissionUpdate
from app.modules.form_submission.schemas.form_submission_query_schema import ExportRequest, HistoryEntry, RecordForm, SubmissionQuery, SubmissionQueryResult
from app.modules.form_submission.services.form_submission_service import FormSubmissionService, get_form_submission_service

permissions.register("submission")
permissions.register("submission", ["export"])  # leaving the system with data is a separate right: admins and editors have it
permissions.define_role("editor", [*permissions.grants_for({"editor"}), "submission:export"])
# people who fill in forms and follow their own requests (an application role: the foundation only knows admin/editor/viewer)
permissions.define_role("submitter", ["template:read", "submission:create", "submission:read", "submission:update", "file:create", "file:read", "directory:read", "view:create", "view:read", "view:update"])

router = secure_router(prefix="/submissions", tags=["Form Submissions"])


@router.post("", response_model=FormSubmissionResponse, status_code=status.HTTP_201_CREATED, summary="Submit a new form",
             dependencies=[Depends(require("submission:create"))])
async def create_submission(body: FormSubmissionCreate, svc: FormSubmissionService = Depends(get_form_submission_service),
                            idem: Idempotency = Depends(idempotency())):
    data = body.model_dump()
    data["status"] = getattr(data.get("status"), "value", data.get("status"))

    async def create():
        return await svc.present(await svc.create_submission(data))

    return await idem.run(create)  # a retried submit (same Idempotency-Key) does not create a second request


@router.post("/drafts", response_model=FormSubmissionResponse, status_code=status.HTTP_201_CREATED, summary="Create a draft submission",
             dependencies=[Depends(require("submission:create"))])
async def create_draft(template_id: UUID = Body(..., embed=True), svc: FormSubmissionService = Depends(get_form_submission_service)):
    return await svc.present(await svc.create_draft_submission(template_id))


@router.post("/export", summary="Export the requests the viewer shows as CSV (names and labels, not ids)", dependencies=[Depends(require("submission:export"))])
async def export_submissions(body: ExportRequest, svc: FormSubmissionService = Depends(get_form_submission_service)):
    filename, content, rows = await svc.export_csv(body)
    return Response(content=content, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename}"', "X-Row-Count": str(rows), "Cache-Control": "no-store"})


@router.get("/query/schema", summary="What the data viewer can do with the submissions of a form (fields, operators, roles, view modes)", dependencies=[Depends(require("submission:read"))])
async def view_schema(template_id: UUID, svc: FormSubmissionService = Depends(get_form_submission_service)):
    return await svc.view_schema(template_id)


@router.post("/query", response_model=SubmissionQueryResult, summary="Filter, search, sort, group and aggregate the submissions of a form", dependencies=[Depends(require("submission:read"))])
async def query_submissions(body: SubmissionQuery, svc: FormSubmissionService = Depends(get_form_submission_service)):
    return await svc.query(body)


@router.get("/{submission_id}/form", response_model=RecordForm, summary="The form a request was filled in on", dependencies=[Depends(require("submission:read"))])
async def record_form(submission_id: UUID, svc: FormSubmissionService = Depends(get_form_submission_service)):
    return await svc.record_form(submission_id)


@router.get("/{submission_id}/history", response_model=list[HistoryEntry], summary="Who changed what, newest first", dependencies=[Depends(require("submission:read"))])
async def history(submission_id: UUID, svc: FormSubmissionService = Depends(get_form_submission_service)):
    return await svc.history(submission_id)


@router.get("/{submission_id}", response_model=FormSubmissionResponse, summary="Get submission details", dependencies=[Depends(require("submission:read"))])
async def get_submission(submission_id: UUID, svc: FormSubmissionService = Depends(get_form_submission_service)):
    return await svc.present(await svc.get(submission_id))


@router.get("", response_model=PaginatedSubmissions, summary="List submissions with filters", dependencies=[Depends(require("submission:read"))])
async def list_submissions(query: SubmissionQueryParams = Depends(), params: PageParams = Depends(page_params), sort: Optional[str] = Query(None, description="created_at | updated_at | status, prefix with - for descending"),
                           svc: FormSubmissionService = Depends(get_form_submission_service), principal: Principal = Depends(get_principal)):
    return await svc.present_page(await svc.list_submissions(params, template_id=query.template_id, status=query.status, created_after=query.created_after, sort=sort,
                                                             submitted_by=principal.user_id if query.mine else None))


@router.patch("/{submission_id}", response_model=FormSubmissionResponse, summary="Update a submission", dependencies=[Depends(require("submission:update"))])
async def update_submission(submission_id: UUID, body: FormSubmissionUpdate, svc: FormSubmissionService = Depends(get_form_submission_service)):
    return await svc.present(await svc.update_submission(submission_id, body.update_dict()))


@router.patch("/{submission_id}/status", response_model=FormSubmissionResponse, summary="Update submission status", dependencies=[Depends(require("submission:update"))])
async def update_status(submission_id: UUID, body: FormSubmissionStatusUpdate, svc: FormSubmissionService = Depends(get_form_submission_service)):
    return await svc.present(await svc.update_submission(submission_id, {"status": body.status.value}))


@router.delete("/{submission_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a submission", dependencies=[Depends(require("submission:delete"))])
async def delete_submission(submission_id: UUID, svc: FormSubmissionService = Depends(get_form_submission_service)):
    await svc.delete(submission_id)
    return Response(status_code=204)
