# ITRMS — Integrated Transport and Road Management System

**የተቀናጀ የትራንስፖርትና የመንገድ ልማት አስተዳደር ሥርዓት**

A multi-tenant system for transport and road development bureaus, zones, woredas and town administrations in Ethiopia:
the 10 work processes and 54 services of a transport and road department (driver and vehicle competency, public transport,
freight, road safety, road quality, design and contracts, community participation, logistics, HR, planning) on one
configurable platform, in Amharic, English and regional languages, with the Ethiopian calendar throughout.

**A product of ABA Nexus Technologies** (ABANEXUS SOFTWARE DEVELOPMENT PLC) · [abanexustech.com](https://abanexustech.com)
· abanexustech@gmail.com

> Proprietary and confidential. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Status
Phase 0 in progress (see [docs/engineering/progress.md](docs/engineering/progress.md)). The web app and design system now
live in `apps/web` and `packages/ui`; the legacy *Digital File Cabinet* backend (`Backend/`, tagged `legacy-dfc`) is
replaced in tasks 0.5–0.6.

## Developer setup
Requires Node.js 24 LTS (`.nvmrc`) and pnpm 12 (`npm i -g pnpm@12.9.1`). Docker runs through WSL2 on Windows.

```
pnpm install                                   # also installs the git hooks (lefthook)
pnpm turbo run lint typecheck test build       # what CI runs, plus:
pnpm boundaries && pnpm check:slices && pnpm test:tools
pnpm gen module                                # new slice package (code-structure.md §10)
```

## Where to start
* [CLAUDE.md](CLAUDE.md): product, stack, design rules, conventions, definition of done.
* [docs/README.md](docs/README.md): all documentation in reading order (architecture, decisions, platform design, phases,
  engineering workflow, go-to-market).
