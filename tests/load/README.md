# Load tests (k6)

## The smoke load test (task 0.26c2)

`smoke.js` puts a few staff on the inbox (`GET /api/v1/me/tasks`) and the data viewer's query API
(`POST /api/v1/submissions/query`) at once for a minute. The requests go through the BFF as a browser sends them, so each
one covers the session, the token, the API and RLS. Its thresholds fail the run:

| Metric | Threshold | Source |
|---|---|---|
| `http_req_duration` p95, per scenario | < 300 ms | [nfr.md](../../docs/engineering/nfr.md): reads |
| `http_req_failed`, per scenario | < 1 % | no failed request |
| `checks`, per scenario | > 99 % | each answer is a 200 with `items` |

It runs nightly in CI (`.github/workflows/nightly.yml`). It also runs on a pull request that changes the load test, and by
hand (`workflow_dispatch`). The run's `summary.json`, `api.log` and `web.log` are kept as the `load-results` artifact for 14
days.

### Running it locally

On the dev stack, with the demo:

```sh
pnpm dev:infra
pnpm --filter @itrms/api build && pnpm demo:reset
pnpm dev                                   # web :3000, api :4000
# the form the query API is asked about: the demo's busiest form, else its first published one
export FORM_ID=<uuid>
pnpm --filter @itrms/web exec playwright test -c playwright.load.config.ts
k6 run tests/load/smoke.js
```

The Playwright step (`apps/web/tests/load-setup/sessions.spec.ts`) signs the demo officers of Boditi in through Keycloak. It
asks the API, as each officer, which of the two calls their roles allow, and writes their cookies to `.sessions.json`, which
is never committed. k6 then sends each kind of request only as the officers allowed to make it, so the test measures
answers and not refusals.

## What it is not

This is a smoke test: a CI runner, the demo's data, ten virtual users. The load test in
[testing-strategy.md](../../docs/engineering/testing-strategy.md) covers the inbox, the query API, search and transitions at
1× and 3× regional load, on a generated data set of 10⁶ records, on the reference server. It is a release gate and comes
later (follow-up in `docs/engineering/progress.md`).
