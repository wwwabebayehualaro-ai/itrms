# ADR-0048: The request context is signed by the API and verified by the database

* Status: accepted (2026-11-08). It supersedes the plain `app.*` settings parts of ADR-0011 and ADR-0031 (the "null-safe
  settings" the policies and the SECURITY DEFINER functions read) and of ADR-0018 (the audit helpers and the context-free
  event function taking their actor as arguments). Closes follow-ups 59, 62 and 69 of the progress record.

## Context

The API told the database who is acting with custom settings (`app.region_id`, `app.scope_path`, `app.party_id`,
`app.user_id`, `app.unit_id`, …) set with `set_config(name, value, true)`. Every RLS policy (all written by
`kernel.apply_rls`) and about thirteen SECURITY DEFINER functions read them. Any session can set such a setting, so an SQL
injection as `itrms_app` could select a wider scope. The context-free event function also took the actor, the request id and
the address as arguments, and an `INSERT` into the audit log named whatever actor it liked. The identity functions took the
Keycloak subject as an argument.

## Decision

1. **One setting, signed.** The API sends `app.ctx` = `<mac hex>:<kid>:<json>` with `json = {exp, usr, reg, unit, scope,
   party, sub, req, ip}` and `mac = HMAC-SHA256(key, kid || ':' || json)`. The key is `CONTEXT_HMAC_KEY` (32 bytes, 64 hex
   characters, never the audit or blind-index key). The token is good for 30 seconds from signing, and the expiry is
   checked against the transaction's start, so a token signed for a transaction stays good for it.
2. **The database verifies.** `kernel.ctx()` (SECURITY DEFINER, STABLE, PARALLEL SAFE) finds the key by `kid` in
   `kernel.context_keys`, which only the owner reads (`itrms_app` and `itrms_system` have no privilege on it), checks the MAC
   and the expiry and returns a `kernel.request_context`. A token that is forged, tampered, expired or of a retired key
   raises `42501` with a message starting `kernel.ctx:`; no setting at all returns NULL (a reused connection matches
   nothing). `kernel.set_context(token)` sets the setting and verifies at once. `kernel.ctx_region()`, `ctx_scope()`,
   `ctx_party()`, `ctx_user()` and `ctx_unit()` are the accessors the policies read.
3. **Policies and functions read only verified values.** `kernel.apply_rls` writes `(SELECT kernel.ctx_region())` and so on
   (still one initplan per query); every table was given its policies again. The SECURITY DEFINER functions that read the
   caller's context (preferences, region keys, the parties' searches, role holders, tasks, notifications, case people,
   approved versions, payment references) read `kernel.ctx()`. A test fails if a policy or any function but `kernel.ctx()`
   mentions `current_setting('app.`.
4. **Follow-up 69.** `kernel.resolve_principal(unit)` answers for the subject in the signed context, and `kernel.my_units()` for
   its user; neither takes a subject. The authenticator signs `{subject}` before it knows the person.
5. **Follow-up 62.** `kernel.record_context_free_event(type, data)` takes the actor, request id and address from the context
   (and adds the subject to the data). A trigger on `kernel.audit_log` overwrites the actor, unit, region, scope, request id
   and address of every row written as `itrms_app` with the context's, so a raw `INSERT` cannot attribute an act to someone
   else. The owner's functions and the system role (which acts for a unit's record, `actFor`) keep what they wrote.
6. **Rotation.** The migrate process installs the configured key after the migrations (`INSERT … ON CONFLICT (kid) DO UPDATE
   SET retired_at = NULL`) and retires the others with a five-minute grace, so requests already signed with the old key still
   verify while the processes restart. The key is in the environment, never in git or a migration.
7. **The system role signs nothing.** `itrms_system` is BYPASSRLS and its context holds only a request id; a context that names
   a person, a region or a unit cannot be set without a key (the API throws).

## Consequences

* An injection as `itrms_app` can no longer widen its scope, name another actor in the audit log or read another subject's
  units. It can still replay a token it has captured for up to 30 seconds, and only as the person that token names.
* The context is still one statement per transaction (`select kernel.set_context(…)`). Each policy evaluates the context once per query, in an initplan. The HMAC is a few microseconds.
* A refused context is logged at error level as `security: forged_context` and answered 403; it is a bug or an attack.
* Deployment: `CONTEXT_HMAC_KEY` is required in production for the API, the workers and the migrate service.
* Not done here: a rate limit on the denial of an account with no ITRMS user (it needs the kernel's rate limiter).

## Licence notes

`pgcrypto` (`hmac`) is already installed with the other extensions; no new dependency.
