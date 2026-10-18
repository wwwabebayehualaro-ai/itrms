# Phase 0 demo plan: driver licences in Wolaita Zone

The Phase 0 gate is "the bureau approves the demo" ([phase-0.md](phases/phase-0.md)). This document fixes **what** is
shown, **where**, **with which data**, and **which facts it rests on**. Sources: **[D]** documents · **[N]**
[ethiopia-context.md](ethiopia-context.md) · **[A]** assumption.

## 1. Scope
- **Tenant:** South Ethiopia Regional State bureau → **Wolaita Zone**, with its 16 woredas and its town administrations
  (7 on the zone site, plus Bitena from the scans) ([tenant-wolaita.md](tenant-wolaita.md) §2) [D][N].
- **Services:**
  - **DVC-03** new driver licence and **DVC-04** renewal ([service-catalogue.md](service-catalogue.md)).
  - Their supporting steps: **DVC-10** exams, **DVC-09** fees, and **DVC-11** print batches.
- **Languages:** Amharic (default), English, Wolaytta (`wal-Latn`) ([i18n-and-languages.md](i18n-and-languages.md)).
- **For all of Ethiopia:** a second demo region with a different structure, e.g. a **city administration with
  sub-cities** and **Afaan Oromo (`om`)** enabled (partial translations, with fallback). It shows that every bureau's
  structure and language are configuration ([go-to-market.md](go-to-market.md) §3).
- **Branding:** "Sample Regional Transport Bureau" with a neutral emblem. No real bureau logo, stamp or official's name
  without permission.
- **Units in the journey** (from the Form 15 staffing tables [D], [tenant-wolaita.md](tenant-wolaita.md) §3):
  - **Boditi town Transport and Logistics Unit** (ፈርጅ 1) has its own driver and vehicle competency team (team leader XV,
    licensing experts, vehicle inspection) and daily revenue collectors. It **handles new licences end to end**.
  - The **zone department's competency team** (team leader XV) handles **renewals** in the demo. It also sees Boditi's
    cases, because Boditi is in its subtree.
  - **Damot Gale woreda** (ምድብ 1) has no competency positions [D]. In the demo, its road-safety officer is the user who
    must **not** see licence cases (sibling isolation).
  - **Who gives the final approval for a town's licence** (the town's team leader, or the zone) is not in the documents
    [A]. The demo makes it **configuration** and shows both settings (step 10).
- **The "two zones" requirement** from the original plan is met by **sibling units of one zone** (Boditi, Damot Gale). A
  synthetic second zone ("Test Zone B") exists only in the automated isolation tests. The product owner chose Wolaita as the
  only real zone.

## 2. Rules the demo follows (Proclamation 1074/2018 [N], §3.1 of the context doc)
| Rule | How the demo shows it |
|---|---|
| Category, minimum age and education (Art. 12) | The applicant's age and education are checked against the chosen category on the server. A 19-year-old asking for Truck I is refused with a clear Amharic message |
| Step-by-step upgrades (Art. 7(2)) | Truck II needs 1 year on a permanent Truck I licence; the lookup finds the existing licence |
| Documents (Art. 14(2)) | Uploads: education certificate, ID (kebele ID or Fayda number), medical certificate, training certificate from a school |
| Medical fitness (Art. 13) | Medical certificate with issuing facility and date; an expired certificate blocks submit |
| Training and exam (Art. 8; service DVC-10 [D]) | Exams happen only **after the training institute has confirmed completion**. The school's readiness list is entered by the handling unit's staff, and the applicant must be on it. Then the examiner enters the theory (computer) and field results |
| Region prints licences, supplies plates, collects fees (stakeholder roles [D]) | The approved licence goes to the **print batch for the region**. The fee step supports both "paid at this office's cashier" and "paid at the revenue office" (receipt reference entered and checked) |
| Temporary licence for 2 years (Art. 15) | The first issue is **temporary**, with the expiry computed as issue + 2 years |
| Renewal for 4 years, 2 if over 55 (Art. 19) | The renewal computes the validity from the holder's age |
| Late renewal over 1 year → practical exam (Art. 19(5)) | The workflow branches: an extra field-exam step appears |
| National platform is the system of record [N] | Issue and renewal call the **fake** `NationalDriverPlatform` adapter through the outbox; the case shows "sent / acknowledged" |
| Fees | Fee amounts are **placeholders** marked "demo", until the regional fee schedule is received (Regulation 572/2025 amounts were not found online [N]) |

## 3. The journey (≈ 20 minutes)
1. **Sign-in** with 2FA. The Keycloak screen is in Amharic, and the user switches the language to Wolaytta and back.
2. **Boditi records officer:**
   - registers a new applicant (Ethiopic + Latin name, birth date in the Ethiopian calendar, optional Fayda number, address
     down to kebele);
   - opens **New driver licence – Automobile**, attaches the documents and picks the training school with a lookup;
   - the form shows the fee preview; the officer submits.
3. **Isolation:** the **Damot Gale** road-safety officer sees no licence cases at all. The **zone** competency officer sees
   Boditi's case (subtree), but cannot act on Boditi's steps unless the configuration routes them to the zone.
4. **Boditi licensing expert:** reviews the documents and returns the case once with a comment ("medical certificate
   unreadable"). The records officer re-uploads it and resubmits. The timeline shows both steps.
5. **Boditi licensing expert (as examiner):** enters the theory (computer) and field results (Ethiopian date).
6. **Payment at Boditi:** the daily revenue collector (cashier role) records the cash payment, and a receipt is issued
   with a gapless Boditi number and a QR code. The alternative, "paid at the revenue office" with a receipt reference, is
   shown in step 9.
7. **Boditi competency team leader:**
   - approves; the reviewer is refused on this step (separation of duties);
   - the effects create a **temporary licence** valid for 2 years, add it to the **print batch for the region**, and send
     it to the fake national platform;
   - a licence certificate PDF (Amharic + English) is produced.
8. **Verification:** scan the QR code on a phone; the public page shows "valid" with a masked name.
9. **Renewal at the zone department:** an applicant whose licence expired 14 months ago. The workflow adds the field-exam
   step, the fee includes the late component, and the fee was paid at the revenue office. The receipt reference is entered,
   stays *pending verification*, and is verified by the zone finance officer. Trying the same reference on another case
   is refused.
10. **Configuration:** the bureau admin shows the **final-approval unit** of the new-licence service, an allowed override:
    - set to "handling unit": Boditi's team leader approves (step 7);
    - switched to "parent unit": the next Boditi case's approval task goes to the zone competency team leader.

    The fee rule cannot be overridden (a disallowed key).
11. **Dashboards:** cases per office, SLA status, revenue per day, the data viewer with Ethiopian dates, and an Excel export.
12. **Audit:** the case's audit trail, showing who did what and when.

## 4. Demo data (generated; never real people) [task 0.25]
- **Org tree:** all Wolaita units (16 woredas, 8 towns known so far). Only the zone, Boditi and Damot Gale have users.
- **People:** ~200 persons with plausible Wolaita names (generated from name lists, not copied from the scans), birth dates
  across the age bands of Art. 12, and kebele addresses.
- **Organisations:** 3 training schools, 2 health facilities.
- **Licences:** ~60 in mixed states (temporary, permanent, expired < 1 year, expired > 1 year, holder over 55).
- **Other data:** exam sessions for the coming month, Ethiopian holidays of the current EFY, fee rules marked "demo".

## 5. What must come from the zone before the demo (blocking the realism, not the build)
1. The paper licence application, medical certificate format, exam result sheet and receipt [D: not yet in `Documents/`].
2. The regional fee schedule for licences [N: amounts not published online].
3. **Who gives final approval** for licences handled by a town's competency team (the town's team leader, or the zone),
   and **who collects fees**:
   - the service list names the regional bureau and the revenue offices as fee collectors, and DVC-09 says the zone
     collects from service recipients;
   - Boditi's staffing has daily revenue collectors [D].
4. The licence and receipt number formats.
5. Wolaytta translations of the demo screens (≈ 300 keys), or agreement to show Wolaytta partially, with fallback to Amharic.

## 6. Acceptance (gate evidence)
- The demo e2e test (Playwright) runs the journey green in `am` and `en`, and `wal-Latn` loads with fallback.
- `pnpm demo:reset` restores the data in under 2 minutes.
- Switching to the second demo region shows its own levels, units, language and branding, with no code change.
- The demo has been shown to officials of **at least two bureaus or zones**, with their feedback recorded in
  `docs/discovery/`.
