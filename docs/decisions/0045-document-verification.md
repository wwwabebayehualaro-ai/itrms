# ADR 0045: Verifying a document

* Status: accepted (2026-11-05, task 0.23b). It refines ADR-0006 and ADR-0031 §10, and builds on ADR-0044. The verifier PWA follows
  in 0.23c. The product owner asked for open questions to be decided by the state of the art and the Ethiopian context; the
  ones that rest on an assumption are marked.

## Context
* A licence, receipt or bolo must be checkable by police, insurers and other offices, with or without a connection. Connectivity
  is uneven outside the towns, and a forged paper is the threat (threat model 2).
* What a checker sees is public, so it must be the minimum.

## Decision
1. **One QR, two checks.** Its text is `https://verify.<domain>/<token>#<payload>.<signature>`. Online, the token asks for current
   status. Offline, the part after `#`, which a browser never sends to a server, proves the document was issued by that
   region. A QR made once needs no change for either.
2. **The token** is 128 random bits. Only its SHA-256 is stored, so the database can't print a valid QR, and it can't be guessed.
3. **The payload** is signed with **Ed25519** and carries only the document's key, number, office code and dates, and a truncated
   hash of the holder's name: a checker with the paper in hand can compare, and the QR alone tells no name.
4. **Keys are per region**, one active at a time, rotated yearly by the PDF worker when it next signs. The private half is sealed
   directly by the installation's key-encryption key (`FIELD_KEYS`, outside the database), not by a data key the database
   holds; a column grant keeps it from the API's role, and it is out of the audit log. A retired key stays for good: what it
   signed still verifies.
5. **Status** is `valid`, `expired` (past its validity), `revoked` or `superseded`, read through one narrow function by token hash.
   A reversed receipt revokes its document. A correction issues a new document and marks the old one, whose stored PDF stays on
   record. A token that isn't one and a token nobody holds answer the same 404.
6. **The public answer** is the document's name and number, the issuing office, its dates and a **masked** holder ("A**** K*****").
   Never the name, the data, or who else holds what. `no-store`, no cookies, no sign-in.
7. **Exposure.** Nginx on `verify.<domain>` serves the static app and proxies exactly `GET /v1/public/verifications/{token}`, rate-limited
   per address, and answers 404 for anything else of the API, the staff app or Keycloak. The API's `/api/v1/public/...` is
   reachable from outside only that way. The CSP is hash-based, written at the app's build (a static export has no per-request nonce).
8. **The rate limit is Nginx's** (60 a minute per address with a burst of 30), not yet shared Valkey limits (SEC-AP-2): there is one
   public Nginx per installation, so its zone already covers every request. *Assumption:* enough until a bureau's traffic shows
   otherwise; a checkpoint behind one address may need it raised.

## Consequences
* Nothing is verifiable before its PDF exists: the token and signature are made by the PDF worker, and only the attempt that records
  the PDF counts.
* `VERIFY_BASE_URL` is required in production, over https, and `FIELD_KEYS` must be kept: losing them loses the signing keys, though
  documents already issued still verify.
* A QR with a long number takes room. It is tested to read back from the licence card at print size.
* The page can't be cached or indexed, and its answer can't be replayed as proof: it says what is true now.
