// The smoke load test (task 0.26c2, testing-strategy.md "Load"): staff working the inbox and the data viewer's query API
// at once, through the BFF as their browsers do. Thresholds are the NFRs for reads (nfr.md: p95 < 300 ms) and no failed
// requests. It is a smoke: a few people for a minute on a CI runner, not the regional load the reference server measures
// (tests/load/README.md).
//
//   k6 run tests/load/smoke.js        (after apps/web's `playwright test -c playwright.load.config.ts`)
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

// the setup's sessions, the app's origin and the form it checked the officers' query against
const setup = JSON.parse(open('./.sessions.json'));
const APP = setup.base;
// where the requests go (another name for the same server); the Origin stays the app's own, as the BFF checks it
const BASE = __ENV.LOAD_BASE || APP;

export const options = {
    // the warm-up is setup()'s: none of its requests is in a scenario, so none is in the thresholds
    setupTimeout: '3m',
    scenarios: {
        inbox: { executor: 'constant-vus', vus: 6, duration: '1m', exec: 'inbox' },
        query: { executor: 'constant-vus', vus: 4, duration: '1m', exec: 'query' }
    },
    thresholds: {
        'http_req_failed{scenario:inbox}': ['rate<0.01'],
        'http_req_failed{scenario:query}': ['rate<0.01'],
        'http_req_duration{scenario:inbox}': ['p(95)<300'],
        'http_req_duration{scenario:query}': ['p(95)<300'],
        'checks{scenario:inbox}': ['rate>0.99'],
        'checks{scenario:query}': ['rate>0.99']
    },
    summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max']
};

// the people who may do each (the setup asked the API as each)
const may = { inbox: setup.sessions.filter((s) => s.inbox), query: setup.sessions.filter((s) => s.query) };

/** The cookies and headers a browser sends for a person allowed this kind of request (`n` picks the person). */
function as(kind, n) {
    const people = may[kind];
    const s = people[n % people.length];
    return {
        cookie: `__Host-itrms_sid=${s.sid}; __Host-itrms_csrf=${s.csrf}`,
        'x-csrf-token': s.csrf,
        origin: APP,
        accept: 'application/json'
    };
}

/** A person's pause between requests: half a second to a second and a half, varying from one iteration to the next. */
const pause = () => sleep(0.5 + (exec.vu.iterationInScenario % 11) / 10);

const inboxPage = (n) =>
    http.get(`${BASE}/api/v1/me/tasks?claim=all&limit=25`, { headers: as('inbox', n), tags: { name: 'inbox' } });
const queryPage = (n) =>
    http.post(
        `${BASE}/api/v1/submissions/query`,
        // the first page, as the data viewer opens: a page past the results is refused, and the demo's form may have few
        JSON.stringify({ formId: setup.formId, page: 1, pageSize: 20 }),
        {
            // the Idempotency-Key the client sends with every POST: a UUID v4 from k6's Web Crypto
            headers: { ...as('query', n), 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
            tags: { name: 'query' }
        }
    );

/** The warm-up: the dev server compiles each route on its first request; asked until both answer quickly. */
export function setup() {
    for (let i = 0; i < 60; i += 1) {
        const a = inboxPage(i);
        const b = queryPage(i);
        if (a.status === 200 && b.status === 200 && a.timings.duration < 500 && b.timings.duration < 500) return;
        sleep(2);
    }
    throw new Error('the inbox and the query API did not warm up');
}

export function inbox() {
    const res = inboxPage(exec.vu.idInTest);
    check(res, { 'the inbox answers': (r) => r.status === 200 && Array.isArray(r.json('items')) });
    pause();
}

export function query() {
    const res = queryPage(exec.vu.idInTest);
    check(res, { 'the query answers': (r) => r.status === 200 && Array.isArray(r.json('items')) });
    pause();
}
