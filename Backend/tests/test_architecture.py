"""Structural rules: the foundation is portable (never imports feature modules) and every installed module describes itself."""
import ast
from pathlib import Path

from app.foundation.registry.spec import ModuleSpec
from app.modules import INSTALLED_MODULES

APP = Path(__file__).resolve().parents[1] / "app"


def _imports(path: Path) -> set[str]:
    out = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            out |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module)
    return out


def test_foundation_never_imports_feature_modules():
    offenders = {str(p.relative_to(APP)): sorted(m for m in _imports(p) if m == "app.modules" or m.startswith("app.modules.") or m == "app.main")
                 for p in (APP / "foundation").rglob("*.py")}
    assert {k: v for k, v in offenders.items() if v} == {}


def test_every_module_folder_is_installed_with_a_spec():
    folders = {p.name for p in (APP / "modules").iterdir() if p.is_dir() and (p / "__init__.py").exists()}
    assert all(isinstance(s, ModuleSpec) for s in INSTALLED_MODULES)
    assert {s.key for s in INSTALLED_MODULES} == folders
    assert all(s.kind in ("coded", "form") for s in INSTALLED_MODULES)  # `platform` is reserved for the foundation
