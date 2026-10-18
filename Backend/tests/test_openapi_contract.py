"""The committed API contract (contracts/openapi.json) must match the code; the frontend types are generated from it."""
from app.foundation.api import contract
from app.main import create_app


def test_contract_is_current():
    assert contract.is_current(create_app()), "contracts/openapi.json is out of date: run `python -m app.cli export-openapi` and `npm run api:types`"
