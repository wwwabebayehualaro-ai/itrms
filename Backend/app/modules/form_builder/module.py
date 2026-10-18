from app.foundation.registry.spec import ModuleSpec, NavGroup, NavItem, RouterMount
from app.modules.form_builder.routers import template_builder_router

SPEC = ModuleSpec(
    key="form_builder",
    title="Form Builder",
    kind="form",
    description="Design forms (templates) with the drag-and-drop builder or the code editor",
    routers=(RouterMount(template_builder_router.router, prefix="/template"),),
    flags=(
        ("forms.require_approval", False, "Publishing a form needs a second person's approval (maker-checker)"),
    ),
    nav=(
        NavGroup("Template Builder", order=20, items=(
            NavItem("Manage Templates", route="/dynamic-template/saved-templates", icon="save", permission="template:read"),
            NavItem("Drag and Drop", route="/dynamic-template/builder", icon="sliders-horizontal", permission="template:create"),
            NavItem("Code Editor", route="/dynamic-template/code-UI", icon="code", permission="template:update"),
        )),
    ),
)
