# ADR 0006: Documents from HTML templates to PDF with Puppeteer, QR verification, Noto Sans Ethiopic

* Status: accepted (2026-10-17, fixed)

> **Amended by [ADR-0031](0031-design-review-hardening.md)** (2026-10-18), item 10.

## Context
Licences, bolo certificates, receipts, association renewals, payment certificates, payroll lists and reports must print
correctly in Ethiopic script with Ethiopian dates. They must also be verifiable when shown to police, insurers or other
offices.

## Decision
* Templates are versioned HTML rendered with **LiquidJS**, so templates contain no code. They take a typed data object
  (checked with Zod) and carry i18n strings and a unit header (logo, name, stamp image) inherited down the org tree.
* The **worker** renders PDFs with **Puppeteer** (headless Chrome). Network access is blocked and the fonts are bundled
  (**Noto Sans Ethiopic**, Noto Sans). The output goes to object storage.
* Each issued document gets:
  * a number;
  * a random verification token, of which only the hash is stored;
  * a **QR code** linking to a public, rate-limited verification page that shows minimal data and the
    valid/revoked/superseded status.
* A hook is reserved for PKI signatures (PAdES) once the bureau holds a certificate (Electronic Signature Proclamation
  1072/2018).

## Consequences
* The worker image includes Chrome (about 300 MB), with a pool of pages and memory limits. PDFs are never rendered in the API
  process.
* Golden-file tests check the rendered PDF of each template (text extraction and page count).

## Licences
Puppeteer: Apache-2.0 (Chrome for Testing: BSD-style, with third-party notices). LiquidJS: MIT. `qrcode`: MIT. Noto fonts:
SIL OFL 1.1, which allows embedding.
