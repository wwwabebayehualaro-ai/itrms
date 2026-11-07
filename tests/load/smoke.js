// The smoke load test (task 0.26c2, testing-strategy.md "Load"): staff working the inbox and the data viewer's query API
// at once, through the BFF as their browsers do. Thresholds are the NFRs for reads (nfr.md: p95 < 300 ms) and no failed
// requests. It is a smoke: a few people for a minute on a CI runner, not the regional load the reference server measures.
//
//   k6 run tests/load/smoke.js        (after apps/web's `playwright test -c playwright.load.config.ts`; FORM_ID set)
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const setup = JSON.parse(open('./.sessions.json'));
const BASE = __ENV.LOAD_BASE || setup.base;
const FORM_ID = __ENV.FORM_ID;

export const options = {
    scenarios: {
        // a short warm-up first: the dev server compiles a route on its first request
        warmup: { executor: 'shared-iterations', vus: 1, iterations: 6, exec: 'warmup', maxDuration: '2m' },
        inbox: {
            executor: 'constant-vus',
            vus: 6,
            duration: '1m',
            startTime: '30s',
            exec: 'inbox'
        },
        query: {
            executor: 'constant-vus',
            vus: 4,
            duration: '1m',
            startTime: '30s',
            exec: 'query'
        }
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

/** The session of this virtual user's person: the cookies their browser sends. */
function as() {
    const s = setup.sessions[exec.vu.idInTest % setup.sessions.length];
    return {
        headers: {
            cookie: `__Host-itrms_sid=${s.sid}; __Host-itrms_csrf=${s.csrf}`,
            'x-csrf-token': s.csrf,
            origin: BASE,
            accept: 'application/json'
        }
    };
}

/** A UUID v4 for the Idempotency-Key the client sends with every POST (a load test's: Math.random is enough here). */
const uuid = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) =>
        (c === 'x' ? Math.floor(Math.random() * 16) : 8 + Math.floor(Math.random() * 4)).toString(16)
    );

const inboxPage = () => http.get(`${BASE}/api/v1/me/tasks?claim=all&limit=25`, { ...as(), tags: { name: 'inbox' } });
const queryPage = () =>
    http.post(
        `${BASE}/api/v1/submissions/query`,
        JSON.stringify({ formId: FORM_ID, page: 1 + Math.floor(Math.random() * 3), pageSize: 20 }),
        {
            ...as(),
            headers: { ...as().headers, 'content-type': 'application/json', 'idempotency-key': uuid() },
            tags: { name: 'query' }
        }
    );

export function warmup() {
    inboxPage();
    queryPage();
}

export function inbox() {
    const res = inboxPage();
    check(res, { 'the inbox answers': (r) => r.status === 200 && Array.isArray(r.json('items')) });
    sleep(0.5 + Math.random());
}

export function query() {
    const res = queryPage();
    check(res, { 'the query answers': (r) => r.status === 200 && Array.isArray(r.json('items')) });
    sleep(0.5 + Math.random());
}
