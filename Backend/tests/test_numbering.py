"""Document numbers: format, yearly reset, gapless on rollback, per tenant, admin listing."""
from datetime import datetime, timezone

import pytest

from app.foundation import context, numbering
from app.foundation.errors import BadRequest

numbering.register("test.po", title="Purchase orders", pattern="PO-{yyyy}-{seq:05}", reset="yearly")
numbering.register("test.voucher", title="Vouchers", pattern="{branch}/{seq:04}")

Y2026 = datetime(2026, 10, 15, tzinfo=timezone.utc)
Y2027 = datetime(2027, 1, 2, tzinfo=timezone.utc)


async def _take(db, tenant_id, key="test.po", *, commit=True, **kw):
    async with db.sessionmaker() as s:
        with context.as_actor(tenant_id, None):
            number = await numbering.next_number(s, key, **kw)
            await (s.commit() if commit else s.rollback())
            return number


async def test_numbers_follow_the_pattern_and_reset_yearly(db, acme):
    t = acme["tenant"].id
    assert [await _take(db, t, now=Y2026) for _ in range(3)] == ["PO-2026-00001", "PO-2026-00002", "PO-2026-00003"]
    assert await _take(db, t, now=Y2027) == "PO-2027-00001"
    assert await _take(db, t, now=Y2026) == "PO-2026-00004"  # each period keeps its own counter
    assert await _take(db, t, "test.voucher", branch="ADD") == "ADD/0001"


async def test_a_rolled_back_document_gives_its_number_back(db, acme):
    t = acme["tenant"].id
    assert await _take(db, t, now=Y2026) == "PO-2026-00001"
    assert await _take(db, t, now=Y2026, commit=False) == "PO-2026-00002"
    assert await _take(db, t, now=Y2026) == "PO-2026-00002"


async def test_each_tenant_counts_on_its_own(db, acme, globex):
    assert await _take(db, acme["tenant"].id, now=Y2026) == "PO-2026-00001"
    assert await _take(db, acme["tenant"].id, now=Y2026) == "PO-2026-00002"
    assert await _take(db, globex["tenant"].id, now=Y2026) == "PO-2026-00001"


async def test_unknown_sequences_are_refused(db, acme):
    with pytest.raises(BadRequest):
        await _take(db, acme["tenant"].id, "nope")


async def test_admins_see_where_each_sequence_stands(client, db, acme):
    await _take(db, acme["tenant"].id)
    rows = {r["key"]: r for r in (await client.get("/platform/sequences", headers=acme["h"])).json()}
    year = f"{datetime.now(timezone.utc):%Y}"
    assert rows["test.po"]["next_value"] == 2 and rows["test.po"]["next_number"] == f"PO-{year}-00002" and rows["test.po"]["period"] == year
    assert rows["test.voucher"]["next_number"] == "{branch}/0001"
    r = await client.post("/auth/users", headers=acme["h"], json={"email": "ed@acme-corp.org", "password": "Sup3rSecret-Passw0rd", "roles": ["editor"]})
    assert r.status_code == 201
    from tests.conftest import _login

    editor = {"Authorization": f"Bearer {(await _login(client, 'ed@acme-corp.org'))['access_token']}"}
    assert (await client.get("/platform/sequences", headers=editor)).status_code == 403
