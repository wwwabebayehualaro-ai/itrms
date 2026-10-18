"""The API contract: the OpenAPI document of the app, written to `contracts/openapi.json` at the repository root.

The frontend generates its TypeScript types from that file (`npm run api:types`), and a test fails when the committed file no
longer matches the code, so a backend change that alters the API cannot be merged without the regenerated contract.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI

#: Backend/app/foundation/api/contract.py -> <repo>/contracts/openapi.json
DEFAULT_PATH = Path(__file__).resolve().parents[4] / "contracts" / "openapi.json"


def render(app: FastAPI) -> str:
    """The OpenAPI document, serialized deterministically (sorted keys, LF, trailing newline)."""
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def write(app: FastAPI, path: Path = DEFAULT_PATH) -> bool:
    """Write the contract; returns True when the file changed."""
    text = render(app)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))
    return True


def is_current(app: FastAPI, path: Path = DEFAULT_PATH) -> bool:
    return path.exists() and path.read_text(encoding="utf-8") == render(app)
