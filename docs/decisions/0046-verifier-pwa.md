# ADR-0046: The verifier PWA: offline proof with published keys

* Status: accepted (2026-11-05, task 0.23c). It builds on ADR-0024 and ADR-0045, and changes ADR-0045's "one API path" to two. The
  product owner asked for open questions to be decided by the state of the art and the Ethiopian context; the assumptions are marked
  and are on the list for the product owner.

## Context

A police officer on a rural road, an insurer or another office has to check a licence or a receipt where there may be no signal.
ADR-0045 put a signed payload in each QR. Something on the phone now has to read it, and has to know the keys.

## Decision

1. **`apps/verify` is an installable app** that opens at `/scan`, in the same static export as the public page. Its service worker
   caches everything the app is at install. It never caches a document's status or the keys: an old answer about a document is worse
   than none.
2. **Keys are published, not built in.** `GET /v1/public/verification-keys` lists the installation's public keys, active and retired,
   from a narrow `SECURITY DEFINER` function, with the names of the kinds of document, since a QR has room only for a key. It is the
   second API path on `verify.<domain>`, under the same GET-only rule and rate
   limit. A key baked into the build would need a release at each yearly rotation, and a key can't be known before the worker first
   signs. The phone refreshes the list whenever it has a connection, skipping any cache, and keeps it in browser storage. An empty list never
   replaces a good one. It trusts the list as it trusts
   the app itself: both come over HTTPS from the bureau's hostname.
3. **Ed25519 in pure JavaScript (`@noble/ed25519`)**, not WebCrypto's Ed25519, which older Android phones lack. It uses RFC 8032's
   strict rules, as the signer does. **QR reading is jsQR**, also pure JavaScript, on the same code path for every phone rather than
   `BarcodeDetector` where it happens to exist. It loads when a scan starts. A photo is the fallback when the camera can't be opened.
4. **What a scan is told** comes from the proof and the live status together:
   * a QR that fails its proof is **forged**, and the API isn't asked;
   * **the signature covers the token as well as the payload**, as it now does from the signer (ADR-0045 §3). A revoked document's
     facts beside another document's token fail, offline too, with no field-by-field comparison and no bigger QR;
   * with a connection, the **live status decides**, and a token of no document is forged;
   * with no answer, the check says the signature is genuine and **says plainly that it can't know of a later cancellation**;
   * a key the phone lacks is not called forged: it first refreshes, and otherwise asks for a connection and warns;
   * a phone that can't run the check at all says so, and says nothing about the document. A QR that lost its proof is not called
     forged on the public page either, where a messaging app may have cut it off.
5. **A retired key proves only what it signed before it retired.** A payload dated after the key's retirement day fails: only someone
   holding the old key could make one.
6. **A scanned address is read, never opened.** A fake QR's own page is what the check is against. The public page uses the same proof
   when the API can't be reached, since the part after `#` is on the phone already.

## Assumptions

* *A phone connects at least once a year.* A phone offline since the last rotation can't prove documents signed by the new key, and
  says so. Publishing the next key before it starts signing would close the gap, if the field shows it matters.
* *One installation's keys.* Each region is its own installation (ADR-0002), so a checker in another region gets "unknown key" offline.
  Sharing keys between regions needs an agreement between bureaus first.
* *Offline facts show the office's code, not its name.* A licence card's code has no room for it, and a directory of offices could be
  published the way document names are, if checkers find a code unhelpful. A live check shows the name.
* *A phone's clock decides "expired" offline.* It is only a display: a wrong clock can't make a forged QR pass.

## Consequences

* There is no way to withdraw trust in a stolen key yet: a retired key's list entry stays good. A compromised-key procedure belongs
  with the operations runbook (task 0.26) and needs a key state of its own.
* Camera access makes the page ask for a permission; `Permissions-Policy` allows it for this origin only, and no other feature.
* Phone cameras, printed cards and real light can only be tried in the field. The tests use Chromium's fake camera with a clean image.
