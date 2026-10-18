"""Installed feature modules, in menu order. Add a module here to mount its routers and menu (see README.md)."""
from app.modules.core_banking.module import SPEC as core_banking
from app.modules.files.module import SPEC as files
from app.modules.form_builder.module import SPEC as form_builder
from app.modules.form_submission.module import SPEC as form_submission

INSTALLED_MODULES = (form_builder, form_submission, files, core_banking)
