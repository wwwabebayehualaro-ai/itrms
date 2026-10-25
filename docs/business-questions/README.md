# Business questions (Amharic)

The questions ABANEXUS SOFTWARE DEVELOPMENT PLC sends to the Wolaita Zone Transport and Road Development Administration
Department, for the answers the design needs (forms, fees, approval chains, the org units, integrations).

| File | What it is |
|---|---|
| `ITRMS-business-questions-am.docx` / `.pdf` | Version 2.0 (ጥቅምት 15 ቀን 2019 ዓ.ም.): the official submission in answer to the department's letter ref. ወዞትመልመ/117 of 09/02/2019 E.C. A cover letter, then 26 questions: 1–12 from version 1.0 (the driving-licence demo) and 13–26 for the other services and stakeholders the letter lists (vehicle registration, bolo, driving schools, public and freight transport, road safety, road construction, maintenance, design and contracts, stakeholder integration, phases, data migration, users, reports, legal approvals), with annexes for the org units, forms, Wolaytta months and days, stakeholder exchanges and service priorities. |
| `build/questions-am.cjs` | The generator of the .docx (the content lives in it). |

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
