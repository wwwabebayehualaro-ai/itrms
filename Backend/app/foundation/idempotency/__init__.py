"""Idempotent commands: a client that retries a POST with the same `Idempotency-Key` gets the first result, not a second effect.

    @router.post("", status_code=201)
    async def create(body: X, idem: Idempotency = Depends(idempotency()), svc = Depends(...)):
        return await idem.run(lambda: svc.create(body))

* Same key, same request (method, path, body) -> the stored response is replayed (header `Idempotent-Replayed: true`).
* Same key, different request -> 422 `idempotency_key_reused`. While the first call is still running -> 409.
* A failed call stores nothing, so it can be retried with the same key. Keys are per tenant and user and expire after a day.
* No header -> the call runs normally (opt-in per request).
"""
from app.foundation.idempotency.guard import HEADER, Idempotency, idempotency, purge_expired  # noqa: F401
