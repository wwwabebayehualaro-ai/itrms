# ADR 0036: The form engine resolves its own words from its own catalogues

* Status: accepted (2026-10-26, task 0.17d; the product owner delegated the engine's design decisions in the unattended
  run of tasks 0.17c–0.18a).

## Context
* The form engine (`packages/form-engine`) has about 500 words of its own: the builder's palette, settings and screens,
  the renderer's buttons and messages, the data viewer, print, and core's default validation messages. Until task 0.17d
  they were English literals, against the rule that no user-visible string lives outside the message catalogues
  (CLAUDE.md, i18n-and-languages.md).
* The web app's words go through next-intl, which merges the slices' catalogues (`apps/web/src/i18n/messages.ts`). The
  engine's words are needed in three more places that next-intl does not reach:
  * **the API**: core's validation runs on the server, and its default messages are the 422's (`POST /submissions`);
  * **the PDF worker** (task 0.23): `@itrms/form-engine/print` renders in Node;
  * **the engine itself**: a package may not import platform slices (dependency-cruiser), so its words cannot live in
    `platform/forms/messages`.
* A mistyped key must fail typecheck (task 0.17d).

## Decision
* The engine keeps its catalogues in `packages/form-engine/messages/<area>/{am,en,wal-Latn}.json` (areas `core`,
  `palette`, `settings`, `designer`, `renderer`, `viewer`). Keys are `form-engine.<area>.…`, and `pnpm i18n:check` checks
  them like every slice's (an area owns its prefix; `am` and `en` required, optional languages reported).
* Core resolves them itself (`engineText`, `engineTranslator`, `wordIn` in `core/messages.ts`) with **intl-messageformat**,
  the ICU formatter under next-intl. The fallback chain is the platform's (`wal-Latn → am → en`, from
  `@itrms/schemas`). Keys are typed from the English catalogues, so a missing or mistyped key is a type error.
* On screen, `useEngineText()` says them in the language of the nearest `<EngineTextLanguage>` (a form is drawn in its own
  language), else the host's (`FormsHost.useLanguages`, which the app feeds from next-intl's locale). The app does not
  merge the engine's catalogues into next-intl.
* Core's validation takes the language (`validateForm(…, { language })`, default Amharic). The API passes the caller's,
  so a 422's default messages are in the caller's language like the author's own already were.
* Words the engine shares with a component of `packages/ui` that has no catalogue (the Ethiopic typing announcement)
  are passed in by the app (`EthiopicTypingProvider`), as `ServerErrorsProvider` and `DataGrid` labels already are.

## Consequences
* There are two i18n runtimes: next-intl for the shell and the slices, the engine's own for the engine. Both read ICU
  messages and the same fallback chain, so a translator sees one format.
* The engine's words go to every page that draws a form (about 15 KB gzipped for `am` and `en`). They can be split by
  entry point later if this matters.
* The form-author and developer diagnostics (formula parse errors, unsupported patterns, document checks) stay English
  until they get error codes. They are shown to the builder only.
* An extension's field type gives its palette and settings words as `I18nText` (`{ am, en }`), never a bare string.
