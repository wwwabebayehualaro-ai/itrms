# ITRMS documentation

Read these in order before implementing anything. Every statement in these documents is marked with its source:
**[D]** the documents in `Documents/` · **[N]** the national context researched online ([ethiopia-context.md](ethiopia-context.md))
· **[A]** an assumption that must be confirmed with Wolaita Zone before it is relied on.

Rule set by the product owner (2026-10-17): follow the `Documents/` folder first. Where it says nothing, follow the national
context. Where neither says anything, state an assumption and ask.

| # | Document | What it settles |
|---|---|---|
| 1 | [audit.md](audit.md) | What the copied project contains, and KEEP / PORT / DROP |
| 2 | [ethiopia-context.md](ethiopia-context.md) | Laws and national systems that shape the design |
| 3 | [tenant-wolaita.md](tenant-wolaita.md) | **The first customer**: Wolaita Zone's org tree, directorates, positions, languages, holidays |
| 4 | [service-catalogue.md](service-catalogue.md) | The 54 services: codes, names, handling level, delivery, phase, national dependencies |
| 5 | [roles-and-permissions.md](roles-and-permissions.md) | System roles derived from the Form 15 positions; permission matrix |
| 6 | [i18n-and-languages.md](i18n-and-languages.md) | Amharic, English and **Wolaytta** (Wolaytattuwa): locales, scripts, fallback, translation workflow |
| 7 | [demo-plan.md](demo-plan.md) | The Phase 0 driver-licence demo in Wolaita: units, people, journey, data |
| 8 | [architecture.md](architecture.md) | The system design |
| 8a | [tech-stack.md](tech-stack.md) | **Every tool and version**, and the answers to all technical open questions |
| 8b | [platform/](platform/README.md) | **One pattern for every office** (unit types, settings), modularization, menus and shell, design system, **security standard**, enterprise capabilities |
| 9 | [decisions/](decisions/README.md) | Fixed decisions (ADRs) |
| 9a | [reviews/](reviews/2026-10-18-design-review.md) | Independent design review and how each finding was resolved |
| 9c | [go-to-market.md](go-to-market.md) | **Self-built product for all of Ethiopia:** market, positioning against national systems, discovery plan, selling to government, risks, changed gates |
| 9b | [value-proposition.md](value-proposition.md) | Why ITRMS: differentiators, citizen benefits, demo "wow" sequence, how value is measured |
| 10 | [phases/](phases/phase-0.md) | Task lists per phase |
| 11 | [engineering/](engineering/workflow.md) | **How work is done and proven:** workflow (ready/done/evidence), [progress log](engineering/progress.md), [NFRs](engineering/nfr.md), [testing strategy](engineering/testing-strategy.md), [API guidelines](engineering/api-guidelines.md), [threat model](engineering/threat-model.md) |
| — | [legacy/](legacy/) | Documents of the copied Digital File Cabinet project (reference only) |

## Open questions for the product owner and the zone (business only)
Every technical question is decided in [tech-stack.md](tech-stack.md). These still need people:

| # | Question | Blocks | Detail |
|---|---|---|---|
| B1 | Paper forms of the Phase 0 services (licence application, medical certificate, exam result sheet, renewal, receipt) | demo realism | [demo-plan.md](demo-plan.md) §5 |
| B2 | Regional fee schedule for licences | fee rules (placeholders until then) | [ethiopia-context.md](ethiopia-context.md) §3 |
| B3 | Who collects fees: office cashier, revenue office or bureau; pre-printed receipt pads or ITRMS numbers | payment step | [service-catalogue.md](service-catalogue.md), stakeholder roles |
| B4 | Towns with a competency team (e.g. Boditi) handle licences, woredas do not [D]: confirm; who gives final approval for a town's licence (its team leader or the zone) | workflows | [roles-and-permissions.md](roles-and-permissions.md) §5 |
| B5 | Amharic spellings, woreda ምድብ and town ፈርጅ for all units; full list of towns (Bitena ፈርጅ 4 is not on the zone site); does Wolaita Sodo city report to the zone or the region | org seed | [tenant-wolaita.md](tenant-wolaita.md) §6 |
| B6 | A named Wolaytta translator and reviewer; month and weekday names in Wolaytta | `wal-Latn` catalogue | [i18n-and-languages.md](i18n-and-languages.md) §7 |
| B7 | Which licensing steps stay local once MoTL's national driver platform is live; interface contacts | Phase 1 adapters | [ethiopia-context.md](ethiopia-context.md) §3 |
| B8 | Summary history across zones (service, date, unit, outcome): allowed? | registry view | ADR-0013 |
| B9 | External accounts for training schools and association committees (Phase 1)? | roles | [roles-and-permissions.md](roles-and-permissions.md) |
| B10 | Payroll: does the office compute tax and pension, or only gross items; Finance's import format | Phase 3 | ADR-0016 |
| B11 | Which offices have frequent internet outages (to measure in the pilot) | pilot plan | ADR-0024 |
| B12 | Is Gifaata an office holiday? Receipt and licence number formats in use | holiday and number seeds | [tenant-wolaita.md](tenant-wolaita.md) §5 |

## Not yet covered (needs the product owner; planned)
| Area | When |
|---|---|
| Requirements per service beyond the two demo services (user stories, acceptance criteria), from the zone's answers and paper forms | before each phase, per service |
| Personas and usability tests with zone staff (records officer, cashier, team leader) | during Phase 0 (demo rehearsal) and the Phase 1 pilot |
| Training and change-management plan; rollout plan per zone | before the Phase 1 pilot |
| User manual in Amharic (and help content in the app) | Phase 1 |
| Support model (levels, response times, local partner) | before the pilot contract |
| Contract, data-processing agreement, pricing; tender wording under public procurement rules | before the first sale |
| Translators' glossary (fixed Amharic/Wolaytta terms for UI and documents) | with the first Wolaytta batch |
