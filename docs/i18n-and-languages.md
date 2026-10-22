# Languages: Amharic, English, Wolaytta

Decided by the product owner (2026-10-17): the first tenant (Wolaita Zone) uses **Amharic, English and Wolaytta**. Other
regions add their own languages (Afaan Oromo, Tigrinya, …) with the same mechanism. Sources: **[D]** documents · **[N]**
online research (cited) · **[A]** assumption.

## 1. The three languages
| | Amharic | English | Wolaytta |
|---|---|---|---|
| Native name | አማርኛ | English | Wolayttattuwaa / Wolaytta doonaa [A: spelling to confirm with a translator] |
| BCP 47 tag used in ITRMS | `am` | `en` | **`wal-Latn`** (`wal` = ISO 639-3) |
| Script | Ethiopic (Geʽez) | Latin | **Latin** for ITRMS. Schools teach Wolaytta in Latin script, though many adults also write it in Ethiopic ([Wikipedia](https://en.wikipedia.org/wiki/Wolaytta_language)) [N] |
| Role | default UI; working language of the region; certificates | second UI; certificates (bilingual with Amharic) | UI language that staff can choose; public-facing texts (SMS, verification page, notices) [A] |
| Fallback | `en` | — | `am`, then `en` |

**Why `wal-Latn` and not plain `wal`:** CLDR and glibc's `wal_ET` data for Wolaytta are a seed or legacy locale in **Ethiopic
script**, copied from Amharic ([CLDR v48 delta](https://www.unicode.org/cldr/charts/48/delta/wal.html),
[glibc wal_ET](https://git.stg.centos.org/source-git/glibc/blob/30c6c88091716e499336c0b54e4b1698796b3d26/f/localedata/locales/wal_ET),
[cldr-users](https://corp.unicode.org/pipermail/cldr-users/2016-January/000432.html)) [N]. ITRMS uses the Latin orthography
taught in schools, so it **does not rely on `Intl`/ICU data for Wolaytta**. Rules:
- UI strings, month names, weekday names and labels for Wolaytta come from **our own catalogues**
  (`wal-Latn.json` in each slice's `messages/` and in `apps/web/messages`, and
  `packages/ethiopian-calendar/src/locales/wal-Latn.ts`).
- Numbers and money use the `en` patterns (`1,234.50`). The digits are Latin.
- `Intl.Collator` sorts Wolaytta with the `en` rules. Search folds the apostrophe variants (see §4).
- If a later region wants Wolaytta in Ethiopic script, add `wal-Ethi` as a separate catalogue. The mechanism supports it.

## 2. What gets translated, and where it lives
| Text | Storage | Who translates | Missing translation |
|---|---|---|---|
| UI strings (buttons, menus, messages, errors) | `<slice>/messages/{am,en,wal-Latn}.json` per slice + `apps/web/messages` for the shell (next-intl, merged at build; code-structure.md §9), keys `<owner>.<area>.<key>` | developers write `en` + `am`; a Wolaytta translator does `wal-Latn` from one merged export per language | **CI fails** for `am` and `en`. For `wal-Latn`, CI reports and the UI falls back to `am` (Wolaytta keys are filled in batches) |
| API error titles | the same catalogues (`<owner>.errors.<code>`, e.g. `kernel.errors.forbidden`) | as above | as above |
| Data names set by the bureau (services, units, roles, document types, licence categories, options) | `I18nText` JSONB `{"am": "…", "en": "…", "wal-Latn": "…"}` | bureau or zone admins in the admin screens | fallback chain; admin screens show "missing" badges |
| Form labels, help, options, messages | `I18nText` in the form definition | form authors in the builder's translation table (task 0.17) | fallback; the publish check warns, it does not block |
| Document templates (certificates, receipts) | per-template string tables per language | bureau | printing a language with missing strings is refused |
| SMS texts | template per language, ≤ 160 GSM-7 characters for Latin; Ethiopic needs UCS-2 (≤ 70 characters per part) | bureau | falls back to `am` |
| People's names | **not translated**: stored as typed in Ethiopic **and** Latin script (two columns) | data entry | Latin name optional |

## 3. Locale behaviour
- **Calendar:** Ethiopian by default for every language (ADR-0015). Month names per language come from
  `packages/ethiopian-calendar`:
  - `am`: መስከረም … ጳጉሜ
  - `en`: Meskerem … Pagume
  - `wal-Latn`: from the translator. Until then the English transliteration is used [A].
- **Dates in print:** Ethiopian first, with the Gregorian date in brackets where the bureau requires it [A].
- **Time:** Africa/Addis_Ababa. The Ethiopian 12-hour clock is an option per user.
- **Money:** `ብር 1,234.50` / `Birr 1,234.50` / `Birr 1,234.50`; stored as santim (ADR-0014).
- **Direction:** all three are left-to-right.

## 4. Fonts and text handling
- Fonts: **Noto Sans Ethiopic** (Amharic) + **Noto Sans** (English, Wolaytta), self-hosted, OFL. They are used in the UI,
  the Keycloak theme and the PDFs.
- Wolaytta's Latin orthography uses an apostrophe-like letter for the glottal stop, which some sources write as `7`
  ([Wikipedia](https://en.wikipedia.org/wiki/Wolaytta_language)) [N]. Search and dedupe therefore **fold `'` `’` `ʼ` `7`**
  into one character, and NFC-normalise everything. Stored text keeps what was typed.
- Ethiopic search: fold the homophone letters (ሀ/ሐ/ኀ, ሰ/ሠ, አ/ዐ, ጸ/ፀ) for name matching only; trigram indexes on the
  folded form. This matters for duplicate detection of persons (task 0.14).

## 5. Translation workflow
1. A developer adds the key to `en.json` and `am.json` in the same PR (CI enforces this).
2. A nightly job lists keys missing in `wal-Latn` (and other optional languages) as a CSV for the translator.
3. The translator returns the CSV. `pnpm i18n:import wal-Latn file.csv` checks the placeholders and ICU syntax and writes the
   catalogue. A reviewer from the zone signs the batch off (recorded in the PR).
4. The `translator` agent may draft `am` strings for developers. **Wolaytta drafts by AI are not shipped without the zone's
   translator reviewing them** [A: quality of machine translation for Wolaytta is unknown].

## 6. Tenant configuration
`tenant_settings.languages = [{tag:"am", default:true}, {tag:"en"}, {tag:"wal-Latn"}]`, and each user picks a language in
their profile. The fallback chain is computed from the list order plus `en`. The installation's region bureau may turn a
language on or off. Turning one off never deletes its translations.

## 7. What the platform does (task 0.13)

* **Messages:** next-intl in `apps/web`; the shell's catalogue and every slice's (`<slice>/messages/*.json`) are merged
  in `apps/web/src/i18n/messages.ts`, a missing text falling back `wal-Latn → am → en`. The language is not in the URL:
  it is the person's preference, kept on the server (`PUT /api/v1/me/preferences`) and mirrored in the `itrms_lang`
  cookie so the server renders in it. `<html lang>` follows it.
* **Check:** `pnpm i18n:check` (CI) fails on a key missing in `am` or `en`, an empty text, a key of another owner, or a
  key that is also another's prefix; missing optional-language keys are reported.
* **Region languages:** `PUT /api/v1/settings/i18n.languages` (a bureau administrator; Amharic and English always on),
  with the admin screen `/admin/languages`.
* **Errors:** the API's problem titles in the request's `Accept-Language`, which the web client sends.
* **Formats:** `apps/web/src/lib/format.ts`: money in Birr from santim (bigint, never a float), dates Ethiopian by
  default (`@itrms/ethiopian-calendar`) with the Gregorian choice.
* **Typing:** F9 turns on phonetic Ethiopic typing in any free-text `Input` or `Textarea` (`selam` → ሰላም); the
  `EthiopianDatePicker` picks dates on the Ethiopian calendar and stores them Gregorian.
* **Search:** `foldForSearch` (`@itrms/schemas`) folds Ethiopic homophones and Wolaytta's apostrophe spellings.

## 8. Open items
1. A named Wolaytta translator and reviewer at the zone.
2. The Wolaytta names of the Ethiopian months and weekdays, and the preferred native name of the language.
3. Whether certificates must also carry Wolaytta (default: Amharic + English only).
4. Whether SMS to citizens should go in Wolaytta, Amharic or both.
