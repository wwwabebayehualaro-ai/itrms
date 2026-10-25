"""Installed feature modules, in menu order. Add a module here to mount its routers and menu (see README.md)."""
from app.modules.files.module import SPEC as files

# the forms moved to the forms API (@itrms/forms, task 0.16c)
INSTALLED_MODULES = (files,)
