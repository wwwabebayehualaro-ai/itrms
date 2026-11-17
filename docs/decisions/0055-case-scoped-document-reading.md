# ADR-0055: Case-scoped document reading, decided through a workflow port and widened by a region setting

* Status: accepted (2026-11-17). Source: the product owner's decision on the 1.4b review ("make it strict and make it
  configurable").

## Context

`issued-document:read` lets its holder list and download every issued document of the active unit's subtree (RLS). The
inspector (`competency.inspector`) needs the documents of the cases it works on (a bolo inspection, a transfer valuation),
not every licence, certificate, receipt and valuation letter of the office.

## Decision

1. **Two permissions.** `issued-document:read` (office-wide, as before) and the narrower `issued-document:read-case`. Every
   role that holds `read` also holds `read-case`; the document routes require `read-case`. A role with `read-case` only
   reads the documents of a case it works on.
2. **Who works on a case** is answered by the workflow through a port (`DOCUMENT_CASE_ACCESS`), as fees reach cases
   (`FEE_CASE_PORT`): a step of the case the person claimed or acted on, or an open step offered to their role in their
   active unit. With no provider the answer is no (fail closed).
3. **A region may widen it.** The setting `documents.case_readers_office_wide` (default `false`, set only at installation
   or region) makes `read-case` holders read office-wide. It never changes RLS: the subtree still bounds every read.
4. A refused download is a 403 with a refusal audit row; a list for a case not worked on is empty, as RLS answers a list.

## Consequences

- Any later case-bound role reuses `read-case` instead of the office-wide permission.
- A test asserts that every role granting `issued-document:read` also grants `read-case`.
- The inspector still reads case attachments through `file:read` and `case:read`; narrowing those is separate work.
