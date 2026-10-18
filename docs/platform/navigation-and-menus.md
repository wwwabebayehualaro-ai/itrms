# Navigation, menus and the application shell

Decision: [ADR-0028](../decisions/0028-menu-and-workspace-model.md).

## 1. What exists today (legacy)
* **What works:**
  * Backend `ModuleSpec.nav` declares groups and items (label, route, lucide icon, permission, `slot`, one level of
    children).
  * `GET /platform/modules` returns the user's menu, filtered by permission and the module flag.
  * `AppNav.tsx` renders it with the shadcn Sidebar (collapsible to icons; a sheet on phones).
  * The `form-templates` slot is filled with the tenant's forms.
* **What's missing:**
  * Labels are English strings.
  * The menu is not aware of the active org unit or the unit's services.
  * Admins can't customise it.
  * There is no global search or command palette, no favourites, recents, badges or role workspaces.
  * Icons are a hand-kept map.
  * "Home" is hard-coded.

## 2. Principles
1. **Declared by modules, computed by the server, customisable by the bureau.** No screen builds its own menu.
2. **The menu shows what the user can do here.** An item appears only when its module is available (entitled, enabled
   and offered in the active unit), and the user holds its permission and the unit has its capabilities.
3. **Grouped by work process**, in the bureau's own vocabulary (the 10 ሥራ ሂደቶች), translated.
4. **Two ways in:** browsing (the sidebar) and searching (the command palette, Ctrl+K). Both use the same data.
5. **Work comes to the user:** an inbox with counts, and role-specific home pages.

## 3. Menu model

```ts
// declared in a module manifest (modularization.md §4)
menu: [
  { key: 'competency.applications', group: 'work-process:1', order: 10,
    label: 'nav.competency.applications',           // i18n key, translated in every enabled language
    icon: 'id-card', route: '/competency/applications',
    requires: { permission: 'licence:read', services: ['DVC-03', 'DVC-04'], capabilities: [] },
    badge: 'competency.openTasks',                  // a count provider (server-side, cached 60 s)
    quickActions: [{ key: 'competency.newLicence', label: 'action.newLicence', route: '/cases/new?service=DVC-03', permission: 'case:create' }] },
  { key: 'competency.printBatches', group: 'work-process:1', order: 40, label: 'nav.competency.printBatches',
    icon: 'printer', route: '/competency/print-batches', requires: { permission: 'licence:print', capabilities: ['prints_documents'] } },
]
```

**Groups** are fixed by the platform:
* Home
* My work (inbox, my cases, drafts)
* one group per work process (1–10)
* Registries (persons, organisations, vehicles, licences, associations)
* Reports
* Administration
* Help

**Effective menu** = manifest items → filtered by availability, permission and capabilities → **bureau overlay** applied →
user's favourites pinned. The server computes it in `GET /me/workspace`, cached per user and active unit and invalidated
when roles, settings or the overlay change.

**Bureau overlay** (admin screen, stored as data, audited):
* rename an item or group (I18nText, e.g. local wording);
* reorder;
* hide (for everyone, or for a unit type);
* add **links** (internal routes or approved external URLs, e.g. the national driver platform);
* choose the default home per role.

An overlay can never show an item that the user's permissions or the unit's services exclude.

## 4. The application shell

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [logo] ITRMS   [ unit switcher: ቦዲቲ ከተማ ▾ ]   [ ⌕ search or command (Ctrl+K) ]  🔔3  ዓ.ም/GC  አማ ▾  👤 │
├───────────────┬──────────────────────────────────────────────────────────────────────────┤
│ Home          │  Breadcrumbs: ብቃት ማረጋገጫ › ማመልከቻዎች › WLT-BOD/000123/2019                     │
│ My work    12 │  ┌ Page header: title · status badge · primary action · more ▾ ───────────────┐ │
│ ★ Favourites  │  │                                                                          │ │
│ 1 ብቃት ማረጋገጫ  │  │  page content (list / record / case / form / dashboard template)        │ │
│   ማመልከቻዎች  7 │  │                                                                          │ │
│   ፈተናዎች      │  └──────────────────────────────────────────────────────────────────────────┘ │
│ 2 ህዝብ ትራንስፖርት │                                                                          │
│ …             │                                                                          │
│ Registries    │                                                                          │
│ Reports       │                                                                          │
│ Admin         │                                                                          │
└───────────────┴──────────────────────────────────────────────────────────────────────────┘
```

* **Unit switcher:** shown only to users with roles in several units. Switching changes the scope of every screen (the
  `X-Org-Unit` header and the RLS scope), and the active unit is always visible. Opening a deep link to a record in another
  of the user's units offers to switch.
* **Command palette (Ctrl+K, cmdk):** one box for:
  * navigation (menu items);
  * actions ("New licence application", "Record payment");
  * records, searched on the server: persons by name in either script or by Fayda number, vehicles by plate or VIN,
    licences, and cases by number;
  * settings.

  Results respect permissions and RLS. Modules contribute search providers.
* **Notifications bell:** in-app notifications (task assigned, SLA due, returned case, print batch back) with read state.
  The same events also go out by SMS or email according to the user's preferences.
* **Calendar and language toggles:** Ethiopian or Gregorian display; am / en / wal-Latn (user preference).
* **User menu:** profile, preferences (theme, density, language, calendar, notifications), security (2FA, passkeys,
  sessions), sign out.
* **Favourites and recents:** pin any menu item or record; recent records per user (last 20), stored server-side so they
  follow the user between PCs.
* **Badges:** counts from providers (open tasks, overdue, print batches to distribute), refreshed every 60 s and on focus.
* **Phones** (inspectors, field staff): the sidebar becomes a sheet, plus a bottom bar with Home, My work, Search and
  Scan (QR verification).

## 5. Role workspaces (home pages)
Each role has a default home made of **widgets** contributed by modules. The bureau can change it per role, and users can
rearrange their own.

| Role | Default home widgets |
|---|---|
| `records_officer` | New application (quick actions), my drafts, cases returned to me |
| `competency.officer` | My tasks (review / exam), today's exam session, overdue cases |
| `competency.lead` | Waiting for my approval, SLA status by step, licences issued this month |
| `cashier` | Open payment orders, today's receipts and total, close cashier session |
| `unit_head` | KPIs of the unit (cases by state, SLA, revenue), escalations |
| `bureau_admin` | Configuration health (unpublished versions, missing translations), job and backup status |

## 6. Routes and deep links
* Route shape: `/<module>/<screen>/<id?>`, e.g. `/competency/applications/0193…`. Cases: `/cases/<id>`. Registries:
  `/registry/persons/<id>`.
* The locale and the unit are **not** in the URL. They are session or user state, so links can be shared between colleagues
  in other units. The server checks access on open.
* Every list view keeps its filters, sort and page in the URL (as the legacy data viewer does), so views can be shared and
  bookmarked.

## 7. Icons
Manifests name lucide icons. A build step collects the names from all manifests and generates the icon map, so the bundle
holds only the icons in use and there is no hand-kept list. An unknown name fails the build.

## 8. Accessibility and performance
* Skip link to the main content; the sidebar is a navigation landmark with arrow-key movement; the active item has
  `aria-current`.
* The command palette is fully usable by keyboard. Shortcuts are listed in Help (`?`).
* The shell is a React Server Component with the workspace data streamed in, so the menu renders without a client
  round-trip. Badges hydrate afterwards.
