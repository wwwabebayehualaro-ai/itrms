from app.foundation.registry.spec import ModuleSpec, NavGroup, NavItem, RouterMount
from app.modules.form_submission.routers import form_submission_router, saved_view_router, server_action_router

STATUSES = (("draft", "pencil"), ("submitted", "send"), ("processing", "settings"), ("completed", "check"), ("failed", "x"))

SPEC = ModuleSpec(
    key="form_submission",
    title="Requests",
    kind="form",
    description="Fill in forms and work with the submitted data (data viewer, saved views, export)",
    depends_on=("form_builder", "files"),  # forms are built in the builder; their attachments are files
    routers=(
        RouterMount(form_submission_router.router, prefix="/form"),
        RouterMount(saved_view_router.router, prefix="/form"),
        RouterMount(server_action_router.router, prefix="/form"),
    ),
    nav=(
        NavGroup("Submitted Forms", order=30, items=(
            NavItem("By Status", icon="arrow-up-down", permission="submission:read", children=tuple(
                NavItem(status.title(), route=f"/submitted-forms/status/{status}", icon=icon) for status, icon in STATUSES
            )),
            # the frontend fills this slot with the tenant's forms, grouped by category
            NavItem("Templates", icon="folder", permission="submission:read", slot="form-templates"),
            NavItem("Quick Actions", icon="zap", permission="submission:read", children=(
                NavItem("My Submissions", route="/submitted-forms/filter/my-submissions", icon="user"),
                NavItem("Recent", route="/submitted-forms/filter/recent", icon="clock"),
            )),
        )),
        NavGroup("Form Initiator", order=40, items=(
            NavItem("Templates Pool", route="/maker/form-intiator", icon="warehouse", permission="submission:create"),
        )),
    ),
)
