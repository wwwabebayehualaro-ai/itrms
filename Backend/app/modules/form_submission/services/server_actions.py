"""Server actions: coded work that runs when a form is submitted (Option 3 hybrid: the form captures, code does the work).

A form names its action in `form_config.runtime.submit.serverAction` (stored with the published version, so it is versioned).
When a request of that form is submitted (any status but draft), the submission service:

1. checks the action's permission for the caller,
2. validates the request's values with the action's `input_model` (422 with one error per form field),
3. runs the handler inside the same database transaction as the request itself: the request and the action's effect are saved
   together or not at all,
4. merges what the handler returns into the request's values and sets its status.

Register an action from a module (`depends_on=("form_submission",)`):

    register_server_action("billing.issue_invoice", title="Issue an invoice", permission="invoice:create",
                           input_model=InvoiceInput, handler=issue_invoice)

    async def issue_invoice(session, ctx: ActionContext) -> ActionResult:
        ...
        return ActionResult(status="completed", data={"invoiceNumber": number})

A request whose action ran is locked (`locks_submission=True`, the default): it cannot be edited, have its status changed or be
deleted through the API (409 `submission_locked`). Later changes come from the module itself, e.g. an approval decision, through
`settle_submission`.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, Mapping

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation import context
from app.foundation.errors import Conflict, Forbidden, ValidationFailed
from app.foundation.security import permissions
from app.modules.form_builder.services import form_config
from app.modules.form_submission.models.FormSubmission import FormSubmission

ActionStatus = Literal["submitted", "processing", "completed", "failed"]
#: `form_metadata` key naming the action that ran for a request (set by the server only)
META_KEY = "server_action"


@dataclass(frozen=True)
class ActionContext:
    """What a handler receives. `input` is the validated `input_model`; `values` the request's values as sent."""

    submission_id: uuid.UUID
    template_id: uuid.UUID
    template_name: str
    actor_id: uuid.UUID | None
    input: BaseModel
    values: Mapping[str, Any]


@dataclass(frozen=True)
class ActionResult:
    status: ActionStatus = "completed"
    #: merged into the request's values (form field ids as keys), e.g. a reference number the form shows afterwards
    data: dict[str, Any] = field(default_factory=dict)


Handler = Callable[[AsyncSession, ActionContext], Awaitable[ActionResult]]


@dataclass(frozen=True)
class ServerAction:
    key: str
    title: str
    description: str
    permission: str
    input_model: type[BaseModel]
    handler: Handler
    locks_submission: bool = True

    def fields(self) -> list[dict[str, Any]]:
        """The form fields the action reads: id (the alias), whether the form must have it, and a description."""
        out = []
        for name, f in self.input_model.model_fields.items():
            out.append({"id": f.alias or name, "required": f.is_required(), "description": f.description})
        return out


_actions: dict[str, ServerAction] = {}


def register_server_action(key: str, *, title: str, permission: str, input_model: type[BaseModel], handler: Handler,
                           description: str = "", locks_submission: bool = True) -> ServerAction:
    if key in _actions:
        raise ValueError(f"Server action '{key}' is already registered")
    action = ServerAction(key, title, description, permission, input_model, handler, locks_submission)
    _actions[key] = action
    return action


def get_action(key: str | None) -> ServerAction | None:
    return _actions.get(key) if key else None


def actions() -> list[ServerAction]:
    return sorted(_actions.values(), key=lambda a: a.key)


def action_key(config: Any) -> str | None:
    """The action a stored form names (`runtime.submit.serverAction`), or None."""
    if not isinstance(config, dict):
        return None
    key = ((config.get("runtime") or {}).get("submit") or {}).get("serverAction")
    return key if isinstance(key, str) and key else None


def locked(sub: FormSubmission) -> bool:
    action = get_action((sub.form_metadata or {}).get(META_KEY))
    return action is not None and action.locks_submission


def _validate(action: ServerAction, values: Mapping[str, Any]) -> BaseModel:
    try:
        return action.input_model.model_validate(dict(values))
    except ValidationError as e:
        errors = [{"field": ".".join(str(p) for p in err["loc"]) or "form", "message": err["msg"]} for err in e.errors()]
        raise ValidationFailed("Some values are not valid", code="invalid_submission", errors=errors) from None


async def run(session: AsyncSession, key: str, *, submission_id: uuid.UUID, template_id: uuid.UUID, template_name: str,
              values: Mapping[str, Any]) -> ActionResult:
    """Run the action named by a form for one request. The caller commits (request and effect in one transaction)."""
    action = get_action(key)
    if action is None:
        raise Conflict(f"This form's server action '{key}' is not available", code="server_action_unavailable")
    if not permissions.allows(permissions.grants_for(context.roles_var.get()), action.permission):
        raise Forbidden(f"You may not perform “{action.title}”")
    ctx = ActionContext(submission_id=submission_id, template_id=template_id, template_name=template_name,
                        actor_id=context.actor_id_var.get(), input=_validate(action, values), values=values)
    return await action.handler(session, ctx)


async def settle_submission(session: AsyncSession, submission_id: uuid.UUID, *, status: ActionStatus, data: Mapping[str, Any] | None = None) -> None:
    """Later outcome of an action (e.g. after an approval): set the request's status and merge values. Same transaction."""
    sub = await session.get(FormSubmission, submission_id, with_for_update=True)
    if sub is None or sub.deleted_at is not None:
        return
    sub.status = status
    if data:
        sub.submission_data = {**(sub.submission_data or {}), **data}
    await session.flush()


def _check_form(config: dict[str, Any]) -> list[dict[str, str]]:
    """Saving a form: the action it names must exist and the form must have the fields the action requires."""
    key = action_key(config)
    if key is None:
        return []
    action = get_action(key)
    if action is None:
        return [{"field": "form_config.runtime.submit.serverAction", "message": f'"{key}" is not a server action of this system'}]
    ids = {str(f.get("id")) for f in config.get("fields") or [] if isinstance(f, dict)}
    missing = [f["id"] for f in action.fields() if f["required"] and f["id"] not in ids]
    if missing:
        return [{"field": "form_config.fields", "message": f"“{action.title}” needs the field(s): {', '.join(missing)}"}]
    return []


form_config.register_check(_check_form)
