# ADR 0015: Time, calendar and languages

* Status: accepted (2026-10-17, fixed)

## Decision
* **Timezone:** Africa/Addis_Ababa (UTC+3, no DST) for every business date. Timestamps are stored as `timestamptz` in UTC,
  and business dates as `date`.
* **Calendar:** dates are stored Gregorian and displayed, entered and printed in the Ethiopian calendar, with a per-user
  toggle to Gregorian. `packages/ethiopian-calendar` handles conversion, per-language formatting and the fiscal year
  (Hamle 1 – Sene 30).
* **Languages are set per tenant**, Amharic and English first. The first tenant (Wolaita Zone) also uses **Wolaytta** in
  Latin script, tagged `wal-Latn`, with the fallback `wal-Latn → am → en` (decided 2026-10-17; details in
  `docs/i18n-and-languages.md`). Afaan Oromo, Tigrinya and other regional languages are added per region the same way.
  Languages whose ICU/CLDR data is missing or in another script use our own catalogues and never depend on `Intl` for names.
  * UI strings live in `next-intl` catalogues. Every key must exist in the **required** languages (`am`, `en`); optional
    languages (e.g. `wal-Latn`) are reported when incomplete and fall back.
  * Data names are `I18nText` values that fall back to the tenant's default language.

## Licences
next-intl: MIT. Noto Sans Ethiopic: OFL. The calendar package is our own code; no GPL calendar library is copied.
