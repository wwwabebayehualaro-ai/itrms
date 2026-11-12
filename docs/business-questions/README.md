# Business questions (Amharic)

The questions ABANEXUS SOFTWARE DEVELOPMENT PLC sends to the Wolaita Zone Transport and Road Development Administration
Department, for the answers the design needs (forms, fees, approval chains, the org units, integrations).

| File | What it is |
|---|---|
| `ITRMS-business-questions-am.docx` / `.pdf` | Version 1.0 (ጥቅምት 15 ቀን 2019 ዓ.ም.), the first official submission: the answer to the department's letter ref. ወዞትመልመ/117 of 09/02/2019 E.C., on the company's letterhead. A cover letter, then 23 questions: 1–10 on the general working, fees and the driving-licence demo, 11–23 on the other services and stakeholders the letter lists (vehicle registration, bolo, driving schools, public and freight transport, road safety, road construction, maintenance, design and contracts, stakeholder integration, phases, data migration, reports, legal approvals), with annexes for the org units, forms, stakeholder exchanges and service priorities. No woreda or town is named as a demo site. |
| `build/questions-am.cjs` | The generator of the .docx (the content lives in it). Questions are numbered by their place, so removing one renumbers every reference (`{Q13}` tokens). |
| `build/assets/` | The letterhead (title page and cover letter) and the logo mark (the other pages' header). |

Earlier internal drafts (a 12-question discovery guide) are in git history; they were never sent.

## Rebuilding

`docx` is not a repository dependency; install it anywhere and point `NODE_PATH` at it:

```bash
npm install --prefix /tmp/docxlib docx@9.5.1
NODE_PATH=/tmp/docxlib/node_modules node docs/business-questions/build/questions-am.cjs
soffice --headless --convert-to pdf --outdir docs/business-questions docs/business-questions/ITRMS-business-questions-am.docx
```

Check the PDF's text, not a PNG made from it with LibreOffice's PDF import: that import mis-orders mixed Ethiopic and
digits, while the PDF itself is correct.

Answers go to `docs/discovery/` (one file per conversation or reply; names and roles only, with consent). The scanned
letter is kept out of the repository (it carries a signature and a stamp).

## Responses

| Received | What | Record |
|---|---|---|
| 2026-11-11 (ኅዳር 2 ቀን 2019 ዓ.ም.) | First written answers from the Wolaita Zone department: 39 scans, handwritten. Partial: questions 11, 12, 13, 16, 17 and 19, plus notes on the licence services and community participation. | [discovery/2026-11-11-wolaita-written-answers.md](../discovery/2026-11-11-wolaita-written-answers.md) |
| 2026-11-11, evening | The documents behind the answers: 40 scans of letters, forms, price lists, stickers and certificates, each marked with the question it answers (11.2–12.5). | [discovery/2026-11-11-wolaita-documents.md](../discovery/2026-11-11-wolaita-documents.md) |
| 2026-11-11, late evening | The licensing documents: 49 scans marked 13.1–13.4 and annexes 1–18 (driving schools, exams, licence print requests, medical report, temporary permits, verification letters, the finance bureau's receipt vouchers, the old libre booklet). | [discovery/2026-11-11-wolaita-licence-documents.md](../discovery/2026-11-11-wolaita-licence-documents.md) |
| 2026-11-12, afternoon | The public transport answers: 10 scans, question 14 typed (routes and tariffs by road class, schedules, the yearly vehicle grading, terminals, association renewal) with four blank forms (the operator competence certificate, the two 100-point grading checklists, the temporary work-permit letter). | [discovery/2026-11-12-wolaita-public-transport.md](../discovery/2026-11-12-wolaita-public-transport.md) |

The scans themselves stay local in `response/` (excluded from git in `.git/info/exclude`, like `Zone Letter/`), one folder
per batch (`1-written-answers/`, `2-vehicle-documents/`, `3-licence-documents/`, `4-public-transport/`), each scan named by its order, question
and content (`05-q11.2-purchase-price-list__2142-1.pdf`, the scan time last), with a local `INDEX.md` and
`rename-map.tsv` (the original CamScanner names). Respondents numbered the questions **as printed** (1–23), which differ from the
generator's internal numbers from question 6 on; the discovery record has the mapping.
