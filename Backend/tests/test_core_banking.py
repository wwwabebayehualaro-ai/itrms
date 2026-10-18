"""Core banking (simulated) + the cash form: lookup, posting in the request's transaction, balance rules, maker-checker above the
limit, locked requests, idempotent submits."""
import pytest

from app.modules.core_banking.settings import get_core_banking_settings
from tests.conftest import PASSWORD, _login

ACTIVE, DORMANT, POOR = "1000000000001", "1000000000002", "1000000000003"
CASH_FORM = {
    "name": "Cash deposit / withdrawal",
    "form_config": {
        "fields": [{"id": f, "type": t} for f, t in (("accountNumber", "InputText"), ("transactionType", "RadioButton"), ("amount", "InputNumber"),
                                                       ("narration", "InputTextarea"), ("depositorName", "InputText"), ("reference", "InputText"),
                                                       ("postingStatus", "InputText"), ("balanceAfter", "InputNumber"))],
        "runtime": {"dataSources": [], "submit": {"serverAction": "core_banking.cash_transaction"}},
    },
    "file_relations": [],
}


async def _user(client, admin_h, email, role):
    r = await client.post("/auth/users", headers=admin_h, json={"email": email, "password": PASSWORD, "roles": [role]})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {(await _login(client, email))['access_token']}"}


@pytest.fixture
async def bank(client, acme):
    admin = acme["h"]
    for number, name, status, balance, currency in ((ACTIVE, "Abebe Kebede", "ACTIVE", "250000", "ETB"), (DORMANT, "Sara Tesfaye", "DORMANT", "1000", "ETB"),
                                                    (POOR, "Dawit Alemu", "ACTIVE", "500", "USD")):
        r = await client.post("/core-banking/accounts", headers=admin, json={"number": number, "holder_name": name, "branch": "Head office",
                                                                              "currency": currency, "status": status, "opening_balance": balance})
        assert r.status_code == 201, r.text
    r = await client.post("/template/forms/templates", headers=admin, json=CASH_FORM)
    assert r.status_code == 201, r.text
    return {"admin": admin, "template": r.json()["id"], "teller": await _user(client, admin, "teller@acme-corp.org", "teller"),
            "supervisor": await _user(client, admin, "supervisor@acme-corp.org", "teller_supervisor")}


def _cash(tid, **values):
    data = {"accountNumber": ACTIVE, "transactionType": "deposit", "amount": 1500, "narration": "Cash deposit", "depositorName": "Abebe", **values}
    return {"template_id": tid, "submission_data": data}


async def _balance(client, h, number):
    return (await client.get(f"/core-banking/accounts/{number}", headers=h)).json()["available_balance"]


async def test_lookup_shows_the_account_to_tellers_only(client, bank):
    r = await client.get(f"/core-banking/accounts/{ACTIVE}", headers=bank["teller"])
    assert r.status_code == 200
    assert r.json() == {"number": ACTIVE, "holder_name": "Abebe Kebede", "branch": "Head office", "currency": "ETB", "status": "ACTIVE", "available_balance": 250000.0}
    missing = await client.get("/core-banking/accounts/9999999999999", headers=bank["teller"])
    assert missing.status_code == 404 and missing.json()["detail"] == "Account not found"
    viewer = await _user(client, bank["admin"], "viewer@acme-corp.org", "viewer")
    assert (await client.get(f"/core-banking/accounts/{ACTIVE}", headers=viewer)).status_code == 403  # *:read does not reach accounts
    assert (await client.post("/core-banking/accounts", headers=bank["teller"], json={"number": "123456", "holder_name": "X", "branch": "Y", "currency": "ETB"})).status_code == 403


async def test_a_deposit_posts_with_the_request(client, bank):
    r = await client.post("/form/submissions", headers=bank["teller"], json=_cash(bank["template"]))
    assert r.status_code == 201, r.text
    sub = r.json()
    assert sub["status"] == "completed"
    assert sub["submission_data"]["postingStatus"] == "Posted" and sub["submission_data"]["balanceAfter"] == 251500.0
    assert sub["submission_data"]["reference"].startswith("TXN-") and sub["submission_data"]["reference"].endswith("-000001")
    assert await _balance(client, bank["teller"], ACTIVE) == 251500.0

    txns = (await client.get(f"/core-banking/transactions?account_number={ACTIVE}", headers=bank["teller"])).json()["items"]
    assert [(t["type"], t["amount"], t["status"], t["submission_id"]) for t in txns] == [("deposit", 1500.0, "posted", sub["id"])]


async def test_refusals_save_nothing(client, bank):
    tid, teller = bank["template"], bank["teller"]
    cases = [
        (_cash(tid, accountNumber=POOR, transactionType="withdrawal", amount=501), "amount", "insufficient_funds"),
        (_cash(tid, accountNumber=DORMANT), "accountNumber", "account_not_active"),
        (_cash(tid, accountNumber="9999999999999"), "accountNumber", "account_not_found"),
        (_cash(tid, depositorName=""), "depositorName", "invalid_submission"),
        (_cash(tid, amount=-5), "amount", "invalid_submission"),
    ]
    for body, field, code in cases:
        r = await client.post("/form/submissions", headers=teller, json=body)
        assert r.status_code == 422, r.text
        assert r.json()["code"] == code and r.json()["errors"][0]["field"] == field
    assert (await client.get(f"/form/submissions?template_id={tid}", headers=bank["admin"])).json()["total"] == 0
    assert (await client.get("/core-banking/transactions", headers=teller)).json()["total"] == 0
    assert await _balance(client, teller, POOR) == 500.0


async def test_withdrawal_within_balance_and_the_same_key_posts_once(client, bank):
    h = {**bank["teller"], "Idempotency-Key": "k-1"}
    body = _cash(bank["template"], transactionType="withdrawal", amount=10000, depositorName=None)
    first = await client.post("/form/submissions", headers=h, json=body)
    again = await client.post("/form/submissions", headers=h, json=body)
    assert first.status_code == again.status_code == 201 and again.headers.get("Idempotent-Replayed") == "true"
    assert first.json()["id"] == again.json()["id"]
    assert await _balance(client, bank["teller"], ACTIVE) == 240000.0


async def test_above_the_limit_a_supervisor_approves(client, bank, monkeypatch):
    monkeypatch.setattr(get_core_banking_settings(), "approval_limit", 5000)
    teller, supervisor = bank["teller"], bank["supervisor"]
    sub = (await client.post("/form/submissions", headers=teller, json=_cash(bank["template"], amount=20000))).json()
    assert sub["status"] == "submitted" and sub["submission_data"]["postingStatus"] == "Awaiting approval"
    assert await _balance(client, teller, ACTIVE) == 250000.0  # nothing posted yet

    locked = await client.patch(f"/form/submissions/{sub['id']}", headers=bank["admin"], json={"submission_data": {"amount": 1}})
    assert locked.status_code == 409 and locked.json()["code"] == "submission_locked"

    inbox = (await client.get("/platform/approvals?scope=to_decide", headers=supervisor)).json()["items"]
    assert len(inbox) == 1 and inbox[0]["policy"] == "bank_txn.post"
    assert (await client.get("/platform/approvals?scope=to_decide", headers=teller)).json()["items"] == []
    assert (await client.post(f"/platform/approvals/{inbox[0]['id']}/approve", headers=teller, json={})).status_code == 403  # the maker never decides

    ok = await client.post(f"/platform/approvals/{inbox[0]['id']}/approve", headers=supervisor, json={})
    assert ok.status_code == 200, ok.text
    after = (await client.get(f"/form/submissions/{sub['id']}", headers=teller)).json()
    assert after["status"] == "completed" and after["submission_data"]["postingStatus"] == "Posted" and after["submission_data"]["balanceAfter"] == 270000.0
    assert await _balance(client, teller, ACTIVE) == 270000.0


async def test_above_the_limit_a_rejection_fails_the_request(client, bank, monkeypatch):
    monkeypatch.setattr(get_core_banking_settings(), "approval_limit", 5000)
    sub = (await client.post("/form/submissions", headers=bank["teller"], json=_cash(bank["template"], transactionType="withdrawal", amount=9000))).json()
    request = (await client.get("/platform/approvals?scope=to_decide", headers=bank["supervisor"])).json()["items"][0]
    r = await client.post(f"/platform/approvals/{request['id']}/reject", headers=bank["supervisor"], json={"comment": "Customer not present"})
    assert r.status_code == 200, r.text
    after = (await client.get(f"/form/submissions/{sub['id']}", headers=bank["teller"])).json()
    assert after["status"] == "failed" and after["submission_data"]["postingStatus"] == "Rejected"
    txn = (await client.get("/core-banking/transactions", headers=bank["teller"])).json()["items"][0]
    assert txn["status"] == "rejected" and await _balance(client, bank["teller"], ACTIVE) == 250000.0


async def test_the_cash_form_needs_the_fields_the_action_reads(client, acme):
    form = {**CASH_FORM, "form_config": {**CASH_FORM["form_config"], "fields": [{"id": "accountNumber", "type": "InputText"}]}}
    r = await client.post("/template/forms/templates", headers=acme["h"], json=form)
    assert r.status_code == 422
    assert "transactionType" in r.json()["errors"][0]["message"] and "amount" in r.json()["errors"][0]["message"]
