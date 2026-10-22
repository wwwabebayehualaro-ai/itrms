# @itrms/ethiopian-calendar

Gregorian ↔ Ethiopian conversion, formatting, fiscal year and the Ethiopian clock, in pure TypeScript with no runtime
dependency (task 0.12). Dates are stored Gregorian and entered, shown and printed Ethiopian (architecture.md §13).

| Part | What |
|---|---|
| `toEthiopian`, `toGregorian`, `…ToJdn`, `jdnTo…` | conversion through the Julian Day Number; leap years (`year % 4 === 3`) and Pagume |
| `formatEthiopian(date, pattern, { language, numerals })` | tokens `yyyy M MM MMMM d dd EEEE G`, quoted text; `numerals: 'ethiopic'` |
| `formatEthiopianLong` | the usual long form per language: "ጥቅምት 12 ቀን 2019 ዓ.ም", "12 Tikimt 2019 E.C." |
| `MONTH_NAMES`, `WEEKDAY_NAMES`, `ERA` | `am`, `en`, `wal-Latn`, `om`, `ti`. The Wolaytta names are transliterations until the translator's arrive (`PROVISIONAL`) |
| `toEthiopicNumeral` | 2018 → ፳፻፲፰ |
| `fiscalYearOf`, `fiscalQuarterOf`, `fiscalYearRange`, `efy(instant)` | the fiscal year, Hamle 1 – Sene 30, named by the year it ends in |
| `toEthiopianTime`, `formatEthiopianTime` | the 12-hour clock counted from 06:00 |
| `addisDate`, `startOfAddisDay`, `ethiopianDayStart`, `ethiopianToday` | business dates in Africa/Addis_Ababa (UTC+3, no daylight saving time) |

Tests: known dates (Meskerem 1 for 1990–2030 E.C., Gena, Timket, Adwa, the millennium); every day from 1900 to 2100
round-trips and steps by one day; every 7th day agrees with ICU's Ethiopic calendar; fast-check properties; formatting
per language.

Rules: [code-structure.md](../../docs/platform/code-structure.md) §3 and §7 (a leaf package: it imports nothing internal).
