# Coded path: complex journeys written as code

One folder per coded feature (route segment = feature id, e.g. `(coded)/purchase-orders/`). Use this path when a feature has
business rules, state transitions, multi-step orchestration, money, idempotency or external integrations (see
`features/README.md` for the checklist). The backend counterpart lives in `Backend/app/modules/<feature>/`.

Rules (enforced by ESLint where possible):

- UI only from `@platform/ui` (design-system primitives: Button, Input, Dialog, ...). No direct `radix-ui`/`@radix-ui/*`
  imports (ESLint error).
- Server state with TanStack Query; HTTP only through `@platform/lib/api/client`; types from `@platform/lib/api/schema`
  (generated from the backend OpenAPI contract).
- Hand-written forms with `useZodForm` (`@platform/lib/forms`: TanStack Form + Zod).
- Gate optional modules with `useFeatureFlag` / `<FeatureGate>`; approvals through `@platform/lib/approval`.
- Reusable screens live beside `page.tsx` (route files take no props).
