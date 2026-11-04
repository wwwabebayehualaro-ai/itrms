# ADR 0044: Issuing documents and the PDF worker

* Status: accepted (2026-11-04, task 0.23a). It refines ADR-0006 and ADR-0031 §10. Signed QR codes and verification follow in
  0.23b and 0.23c. The product owner asked for open questions to be decided by the state of the art and the Ethiopian
  context; the ones that rest on an assumption are marked.

## Context
* Receipts, application copies, licences and exam sheets must print correctly in Ethiopic with Ethiopian dates. What an
  office printed must not change later, and a reprint must be that same document.
* Chrome is heavy and hostile input can reach a template through an applicant's answers.

## Decision
1. **A document is frozen when it is issued.** `issued_documents` keeps the template version, the data (checked against the
   shape the template names, one of `DOCUMENT_DATA_SCHEMAS`), the language and the unit's header as they were, in the caller's
   transaction. Only its PDF is added later, once. Data stays out of the audit log: it may hold personal data. A document
   carries a number only if the record it documents has one, so numbers stay with the counters of that record (ADR-0014).
2. **A reprint is the stored PDF**, through a short-lived link, on record (`document.printed`). Nothing renders it again.
3. **Rendering has its own process and queue.** The relay routes `document.render.v1` to the `documents` queue, consumed only by
   `worker-documents`. A dependency rule (`only-the-pdf-worker-reaches-chrome`) keeps Chrome out of the API and the main worker;
   a stuck render can't hold the outbox, SLA timers or notifications.
4. **Three walls around a page.** LiquidJS escapes every output and `raw` can't turn that off, with no partials from disk and
   bounded parse and render. Chrome runs with JavaScript off, offline, every request refused but inline data, and names that
   resolve nowhere. The page's CSP is `default-src 'none'`, allowing only inline fonts, images and styles.
5. **`puppeteer-core` with a Chrome the image installs** (`CHROME_PATH`), not Puppeteer's download: the version is the image's to
   pin and scan, and installing dependencies downloads no browser. Fonts are the static Noto Sans and Noto Sans Ethiopic, inlined.
6. **What fails.** A template or data problem is the document's: `failed`, on record, not retried. Chrome or the store failing is
   retried, then dead-lettered like any event. A region without a template keeps its receipt, with no document yet.
7. **Issuing.** A receipt's document on `receipt.issued.v1`. A workflow's `documents.issue:application-copy` copies the request, never a
   sensitive field; a work process with its own data issues through `DocumentsService` from its effect (0.24). Issued again for
   the same record, it is the same document.
8. **Language.** *Assumption:* a receipt issued by the worker prints in Amharic; a document issued by a person's step prints in
   that person's language. A region's own default is a follow-up.
9. **Headers** are the class-C setting `documents.header` (a title, a subtitle, an inline logo and stamp), inherited down the tree;
   without one, the office's name. Real names, logos and stamps only with permission.

## Consequences
* The deployment needs the `worker-documents` service, with Chrome in its image and a memory limit (task 0.26).
* Layouts stand in until a bureau's forms are known. Editing templates on a screen, and their approval, is a follow-up: for now a
  template changes by seed, as a new version; documents already issued keep theirs.
