# 2026-11-12 · Wolaita Zone: the public transport answers (Q14)

| | |
|---|---|
| **Organisation** | Wolaita Zone Transport and Road Development Administration Department (the reference design, not a customer) |
| **Answers** | Printed question 14 of the questionnaire (generator no. 16: public transport routes, schedules and grading), items 14.1–14.6, with the forms they name. Earlier batches: [written answers](2026-11-11-wolaita-written-answers.md), [vehicle documents](2026-11-11-wolaita-documents.md), [licence documents](2026-11-11-wolaita-licence-documents.md). |
| **Received** | 2026-11-12, afternoon: 10 phone scans (CamScanner, 15.31–15.35), one page each. |
| **Form** | Two typed pages of answers (unsigned); four blank forms: the zone department's temporary work-permit letter, the regional bureau's operator competence certificate, and its two 100-point grading checklists (small and medium public transport vehicles). |
| **Personal data** | None seen: the answers are typed and the forms are blank. The scans still stay out of the repository with the others (`docs/business-questions/response/4-public-transport/`, excluded in `.git/info/exclude`). |
| **Confidence** | Typed and printed text **H** unless marked; readings of small print or inferred meanings **M** or **L**. |

## What the answers settle

1. **A new route is opened on demand, and its tariff is the region's** (14.1).
   - Requests come from organisations and the public. The routes are studied and the needed service is found; the zone,
     woreda or town opens the route.
   - The **regional bureau sets the tariff per kilometre**, by the road's condition, and the office that asked applies
     it by letter. Three road classes (M on the details):
     1. asphalt;
     2. gravel;
     3. a third class, earth or poor gravel, with its own levels 1–3 by road condition.
   - → **Task 1.10:** a route carries its road class per section (asphalt, gravel, earth with a level) and its length;
     the tariff is the bureau's per-km rate by class (versioned, region-approved), and the fare is computed from it.
2. **The monthly schedule comes from the licensed associations** (14.2): the woreda's deployment schedule is drawn up by
   the associations organised and licensed to give the service, and approved by the work process (M).
   - → **Task 1.11** as planned (the association submits, the work process approves; ADR-0053).
3. **"Annual grading" is per vehicle** (14.3), and it gives the vehicle a **level** on a certificate.
   - The criteria, out of 100: the vehicle's age (production year) **30**; safety **34** (no defects, insurance, a
     maintenance contract with a garage, seat belts, a fire extinguisher, a first-aid kit, a speed limiter …); comfort
     **34**; other **2**.
   - **Level 1:** 80–100 points. **Level 2:** 65–79.99. **Level 3:** 50–64.99. Below 50 is not graded (M: implied).
   - Two printed checklists, both "prepared and approved in Megabit 2005 E.C.", one per vehicle class (see the
     [sample-forms register](sample-forms.md#public-transport)). Their weights differ: the small-vehicle form has safety 30
     and comfort 38; the medium-vehicle form adds emergency exits, a driver partition and a luggage rack.
   - The level goes on the **operator competence certificate** (የኦፐሬተርነት ብቃት ማረጋገጫ ፈቃድ), the regional bureau's
     printed form, issued under the Transport Proclamation 468/97 E.C. (468/2005), article 12/2. **It is valid to Sene 30
     of the fiscal year only, and lapses unless renewed each year.** Its number reads `ት/መ/ል/ስም-NNN/2018/19` (a
     sequence per fiscal year, the year written as the two E.C. years it spans).
   - → **Task 1.11 (new item):** the yearly vehicle grading, on the `Checklist` form type (1.13a) with weights, two
     versions by vehicle class; the level computed from the total by configured thresholds; the operator competence
     certificate as an ITRMS document (QR, the fiscal-year counter, valid to the end of the fiscal year); its renewal
     reminders. An association's yearly renewal picks up its graded vehicles.
4. **Tariffs are made known on the vehicle and at the terminal** (14.4): the region sets them from all vehicle costs and
   fuel prices; they are posted on the vehicles' windows and, at some terminals, on a billboard.
   - → **Task 1.10:** a printable tariff sheet per route (vehicle window) and per terminal (billboard).
5. **Terminals are run by the transport and road development offices, and they charge a terminal fee** (14.5).
   - → **Task 1.10:** a terminal has its managing office; the terminal fee is a fee rule (amounts asked, R13).
6. **An association's yearly licence renewal needs five documents** (14.6): the annual audit report, the annual work
   report, the members' attendance, the minutes of the general assembly, and the members' documents completed by the
   association. The fee is for **the renewal paper**.
   - → **Task 1.11:** the renewal's required attachments (configuration) and its fee rule.
7. **A vehicle can be given a temporary work permit** (the zone department's blank letter, ጊዜያዊ የሥራ ፈቃድ ስለመስጠት).
   - "To whom it may concern": the owner, plate, chassis and engine numbers; the vehicle asked on (date) for a temporary
     deployment on (a route); it is allowed **only from … to …**; please cooperate. Copies to the department head and the
     public transport work process; place Sodo.
   - → **Task 1.11:** a temporary deployment permit (an ITRMS document with a QR and a validity window), like the
     temporary bolo and the temporary driving permit.

## Requests back to the zone

- **R13.** The terminal fee and the association renewal fee (amounts), and the per-km tariff table by road class.
- **R14.** Which vehicles take which grading form (seats, or the vehicle class), whether a vehicle below 50 points may
  run, and who signs the operator competence certificate (the zone or the region).
- **R15.** Who may ask for a temporary work permit, how long it may run, and whether it is charged.

## Files

| File (`response/4-public-transport/`) | Item | Content |
|---|---|---|
| `01-…`, `02-…` | 14.1–14.6 | Typed answers (two pages) |
| `03-…` | 14 | Temporary work-permit letter (blank) |
| `04-…` | 14.3 | Operator competence certificate (blank) |
| `05-…`–`07-…` | 14.3 | Grading checklist, small public transport vehicles (three pages) |
| `08-…`–`10-…` | 14.3 | Grading checklist, medium public transport vehicles (three pages) |
