from app.foundation.registry.spec import ModuleSpec, RouterMount
from app.modules.files.routers import file_upload_router

SPEC = ModuleSpec(
    key="files",
    title="Files",
    kind="coded",
    description="File uploads, preview and download",
    routers=(RouterMount(file_upload_router.router, prefix="/files"),),
)
