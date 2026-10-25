# Business questions (Amharic)

The questions ABANEXUS SOFTWARE DEVELOPMENT PLC sends to the Wolaita Zone Transport and Road Development Administration
Department, for the answers the design needs (forms, fees, approval chains, the org units, integrations).

| File | What it is |
|---|---|
| `ITRMS-business-questions-am.docx` / `.pdf` | Version 2.0 (ጥቅምት 15 ቀን 2019 ዓ.ም.): the official submission in answer to the department's letter ref. ወዞትመልመ/117 of 09/02/2019 E.C., on the company's letterhead. A cover letter, then 24 questions: 1–10 from version 1.0 (the driving-licence demo; its questions on the Wolaytta translation and on internet, computers and power were left out) and 11–24 for the other services and stakeholders the letter lists (vehicle registration, bolo, driving schools, public and freight transport, road safety, road construction, maintenance, design and contracts, stakeholder integration, phases, data migration, users, reports, legal approvals), with annexes for the org units, forms, stakeholder exchanges and service priorities. No woreda or town is named as a demo site. |
| `build/questions-am.cjs` | The generator of the .docx (the content lives in it). Questions are numbered by their place, so removing one renumbers every reference (`{Q13}` tokens). |
| `build/assets/` | The letterhead (title page and cover letter) and the logo mark (the other pages' header). |

Version 1.0 (ጥቅምት 8 ቀን 2019 ዓ.ም., 12 questions) is in git history.

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
