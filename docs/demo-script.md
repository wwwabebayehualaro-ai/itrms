# Demo script

What the presenter does and says in the demo journey of [demo-plan.md](demo-plan.md) §3, step by step. Each step names the account to
use, what to do, and the line to say, in **Amharic** (the default, for bureau and zone officials) and **English** (for partners).
Wolaytta is shown in step 1: its screens fall back to Amharic until the zone's translations arrive (demo-plan.md §5).

The same journey runs as a Playwright test, in Amharic and in English: `apps/web/tests/e2e/demo/journey.spec.ts` (steps 1–10, tasks 0.25c and 0.25d).
Steps 9 and 10 are task 0.25d; steps 11 and 12 (the figures, the audit trail) follow in task 0.25e.

## Before the demo
- `pnpm demo:reset` on the demo stack (under 2 minutes). It builds both demo regions from nothing: the Wolaita zone of the
  "Sample Regional Bureau", and the made-up city administration.
- Every demo account's password is the demo password. The first sign-in sets up the second factor: have an authenticator app ready.
- Open one browser window per person (or one profile each): the records officer, the licensing expert, the revenue collector and the
  team leader of Boditi; the Damot Gale road-safety officer and the zone's competency officer for step 3.
- All names, numbers and documents are generated. Never show a real person's data.

| Person | Account | Office |
|---|---|---|
| Records officer | `demo.boditi.records` | Boditi town |
| Licensing expert (reviewer and examiner) | `demo.boditi.officer` | Boditi town |
| Daily revenue collector (cashier) | `demo.boditi.cashier` | Boditi town |
| Competency team leader | `demo.boditi.lead` | Boditi town |
| Road-safety officer | `demo.damot.safety` | Damot Gale woreda |
| Zone competency officer | `demo.zone.officer1` | Wolaita zone department |

## 1. Sign-in, with a second factor, in the bureau's languages
**Do:** sign in as `demo.boditi.records`. The sign-in screen is in Amharic. Enter the code from the authenticator app. In the app,
open the user menu → **ቋንቋ** → **Wolayttatto**, show the screen, then switch back to **አማርኛ** (or **English**).

- **am:** «ሥርዓቱ በሁለት ደረጃ ማረጋገጫ ይከፈታል፤ የይለፍ ቃል ብቻ አይበቃም። ቋንቋውን ሠራተኛው ራሱ ይመርጣል፤ ወላይትኛ ትርጉሙ እስኪደርስ በአማርኛ ይታያል።»
- **en:** "Every sign-in takes a second factor; a password alone is not enough. Each officer picks their own language. Wolaytta shows
  Amharic wherever its translation has not arrived yet."

## 2. A new applicant, the school's list, and the request at the counter
**Do (records officer):** **የሰዎች መዝገብ** → **ሰው መመዝገብ**. Enter the name in Ethiopic and Latin letters, the birth date in the
Ethiopian calendar, a Fayda number and the address down to the kebele. **Do (licensing expert):** on the training list, add the
applicant to *Sample Driving School A* for the Automobile grade and mark the training complete. **Do (records officer):**
**Applications** → **New driver licence**: pick the applicant and the school by searching, attach the four documents (education,
ID, medical, training), and point out the fee shown before filing. File it, then submit it.

- **am:** «አመልካቹ አንድ ጊዜ ይመዘገባል፤ በክልሉ በሙሉ ያው መዝገብ ነው። ቀኑ በኢትዮጵያ አቆጣጠር ይገባል። ክፍያው ጥያቄው ከመግባቱ በፊት ይታያል፣ ከክልሉ የክፍያ ደንብ ይሰላል።»
- **en:** "An applicant is registered once, for the whole region. Dates are entered in the Ethiopian calendar. The fee is shown before
  the request is filed, worked out from the region's fee rule."

## 3. Each office sees its own work
**Do:** as `demo.damot.safety`, show that there is no licence menu and that Boditi's case cannot be opened. As
`demo.zone.officer1`, open the same case: the zone sees it (Boditi is below the zone), but it has no step to take on it.

- **am:** «የዳሞት ጋሌ ባለሙያ የቦዲቲን ጉዳይ አያይም። ዞኑ ከበላይ ሆኖ ይከታተላል፤ ሥራው ግን የቦዲቲ ነው።»
- **en:** "Damot Gale's officer cannot see Boditi's case. The zone, above Boditi, follows it; the work stays with Boditi."

## 4. Returned once, corrected, on the record
**Do (licensing expert):** open the case → **ለማስተካከያ መልስ**, with the comment "የመታወቂያው ቅጂ አይነበብም" ("the scan of the ID is
unreadable"). **Do (records officer):** open the case, read the comment, **አስተካክለህ አስገባ**, attach a new scan of the ID, resubmit.
Show the timeline: the return, its comment, and the correction naming the changed document. The medical certificate is not in the
correction form: it is sensitive, the records officer never sees it, and it stays as it was.

- **am:** «ጉዳዩ በአስተያየት ይመለሳል፤ የተስተካከለውም ሰነድ በጊዜ ቅደም ተከተሉ ላይ ይታያል። ማን፣ መቼ፣ ምን እንደሠራ ይመዘገባል። የህክምና ማስረጃ ሚስጥራዊ ስለሆነ መዝገብ ሠራተኛው አያየውም።»
- **en:** "A case goes back with a comment, and the corrected document is on its timeline: who did what, and when. The medical
  certificate is confidential: the records officer never sees it."

## 5. The exam
**Do (licensing expert, as examiner):** approve the documents, then on the exam step enter the exam date (Ethiopian calendar), the
theory and practical scores, and **አልፏል** (passed).

- **am:** «የፈተናው ውጤት በጉዳዩ ላይ ይገባል፤ ያለፈ አመልካች በቀጥታ ወደ ክፍያ ይሄዳል።»
- **en:** "The exam results go on the case; a pass sends it straight on to payment."

## 6. The fee at Boditi's till
**Do (revenue collector):** **Cashier** → the case in the queue → **ክፈት**, enter the amount and the payer, record the payment. The
receipt opens with its Boditi number; its PDF carries a QR code.

- **am:** «ደረሰኙ ቁጥሩ ከቦዲቲ ተከታታይ ቁጥር ይወጣል፤ ቁጥር አይዘለልም፣ አይደገምም።»
- **en:** "The receipt number comes from Boditi's own sequence: no number is skipped, none is used twice."

## 7. Final approval, the licence and its card
**Do:** as the licensing expert, show that the case at **final approval** offers them no action: whoever reviewed cannot approve.
As `demo.boditi.lead`, **አጽድቅ**. The national platform answers (here, a stand-in), the **temporary licence** for two years is made,
added to the region's print batch, and the licence card PDF is produced.

- **am:** «ያጣራው ባለሙያ ራሱ አያጸድቅም፤ የቡድን መሪው ያጸድቃል። ፈቃዱ ጊዜያዊ ሲሆን ለሁለት ዓመት ያገለግላል፣ ለህትመትም ወደ ክልሉ ይላካል።»
- **en:** "The reviewer never approves their own work; the team leader does. The licence is temporary, valid for two years, and goes to
  the region's print batch."

## 8. Anyone can check the card
**Do:** scan the card's QR code with a phone (or tap it on the PDF). The public page shows **valid**, the licence number, and only a
masked name.

- **am:** «ማንም ሰው ካርዱን በስልኩ ማረጋገጥ ይችላል፤ ስሙ ግን ተደብቆ ይታያል።»
- **en:** "Anyone can check a card with their phone, and sees only a masked name."

## 9. A renewal at the zone, 14 months late, paid at the revenue office
**Do:** as `demo.dual`, switch the active office to the **zone department** (unit switcher), then **Applications** → **Licence
renewal**: pick a licence that expired 14 months ago (the demo has eight), its grade, its expiry date (Ethiopian calendar), the
medical facility and examination date. Submit. As `demo.zone.officer1`, approve the documents: the case goes to the **practical
exam**, which a renewal more than a year late needs (Art. 19(5)). As `demo.zone.examiner`, record the pass. Open **Paid
elsewhere**: the payment order shows the late component. Enter the revenue office's receipt number, amount, date and payer: it
waits for verification. As `demo.zone.finance`, verify it. As `demo.zone.lead`, approve: the licence is renewed. Then take a
second late renewal to its payment and enter the same receipt number: refused.

- **am:** «ከአንድ ዓመት በላይ የዘገየ እድሳት የተግባር ፈተና ይጨምራል፣ የመዘግየት ክፍያም ይታከላል። በገቢዎች ጽ/ቤት የተከፈለ ደረሰኝ በሌላ ሰው እስኪረጋገጥ ጉዳዩ አይቀጥልም። አንድ ደረሰኝ ሁለት ጊዜ አያገለግልም።»
- **en:** "A renewal more than a year late adds a practical exam and a late fee. A receipt paid at the revenue office moves the case on
  only once another person has verified it, and it pays one order only."

## 10. The bureau decides who gives final approval
**Do:** as `demo.bureau.admin`, open **Services** → **DVC-03 New driver licence** → *An office's configuration*, choose **Boditi**,
and change **the office that gives final approval** to **the office above it**, with a reason. Point out what cannot be changed
there: the fee rule is the region's. File Boditi's next new licence (as in steps 2 and 5) and pay it at Boditi's till. The final
approval is now in the **zone** team leader's tasks, not Boditi's.

- **am:** «ቢሮው ለእያንዳንዱ ጽ/ቤት የመጨረሻ ማጽደቂያውን ማን እንደሚሰጥ ይወስናል፤ ክፍያው ግን የክልሉ ደንብ ነው፣ ጽ/ቤት አይቀይረውም።»
- **en:** "The bureau decides, office by office, who gives the final approval; the fee is the region's rule, which no office changes."
