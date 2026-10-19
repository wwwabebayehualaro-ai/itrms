# Builder path: forms made with the Form Builder

Screens of the configuration-driven path (Option 3 "builder simple"): designing templates, filling them in, and viewing the
submitted data. Everything here is generic over *any* form; a new simple form needs no code, only a template made in the
builder (and, once approvals are on, a published version).

* `dynamic-template/` - builder, template gallery, code editor
* `submitted-forms/` - data viewer (table, cards, board, calendar, pivot, dashboard), request pages, history
* `(actors)/maker/` - form initiator

Use only `@platform/form-engine`, `@platform/form-engine/builder`, `@platform/ui` and `@platform/lib`. Business logic that
needs code (multi-step orchestration, money, external systems) does not belong in a form: build it as a coded feature in
`../(coded)`.
