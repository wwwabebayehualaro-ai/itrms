# ADR 0035: Filterable form fields are indexed in a typed value table

* Status: accepted (2026-10-24, product owner: "the industry-standard way"). It **amends ADR-0031** §17 and
  [architecture.md](../architecture.md) §11, which said filterable fields get "expression or partial indexes, created
  when the form is published".

## Context
* Answers are JSONB in one shared table, `forms.submissions`, for every form of every unit (architecture §6.2). A form
  author marks the fields people filter by. The data viewer must answer a query over 10⁶ submissions, filtered by form
  and a filterable field, in under 300 ms under RLS (NFRs).
* An expression or partial index per form and field (`… ((answers->>'plate')) WHERE form_id = …`) is DDL, and PostgreSQL
  lets only the table's owner run it. By design the API (`itrms_app`) and the worker (`itrms_system`) are not owners
  (ADR-0011, ADR-0031, security.md); only the one-shot migrate process holds the owner's credentials. The options:
  * **a SECURITY DEFINER function owned by `itrms_owner`**, callable only by the worker: a function runs in a
    transaction, so it cannot use `CREATE INDEX CONCURRENTLY`. The build takes a lock that blocks new submissions to
    *every* form for as long as it scans the form's rows (seconds at 10⁶);
  * **the owner's credentials in a worker job**, for `CONCURRENTLY`: a long-running process then holds the one role RLS
    does not bind, against least privilege;
  * either way the index count grows with forms × fields. That bloats the catalogue, slows planning, and makes every
    insert into the shared table check every partial index's predicate;
  * **a typed value table with fixed indexes:** the pattern of metadata-driven multitenant platforms (Salesforce's
    "indexes pivot table" in its multitenant architecture: values of fields marked for indexing are copied synchronously
    into typed columns with ordinary indexes, and a tenant's choices never change the schema).

## Decision
* `forms.submission_values`: one row per submission and filterable field that holds a value. Columns: `submission_id`,
  `form_id`, `field_key`, and a typed value (`value_text`, `value_num` `double precision`, `value_date`, `value_ts`,
  `value_bool`), with the submission's `region_id` and `org_path`. It is class T, like the submission. The values are folded and
  bounded as the query compiler compares them.
* The forms service writes them **in the same transaction as the submission**, from the filterable fields of the
  submission's own version. A client never writes them, and they are never edited apart from their submission.
* Every value type has a comparison PostgreSQL marks **leakproof** (`text`, `double precision`, `date`, `timestamptz`,
  `boolean`). Under RLS only a leakproof condition may become an index condition; any other runs as a filter after the
  policies, over every row of the field. So numbers are stored as `double precision`. That is exact, because a form
  answer's number is a JSON number, a double in the browser and the API alike; money fields carry integer santim
  (task 0.18). It is not `numeric`, whose comparisons are not leakproof (measured: a range over 10⁵ rows ran as a 340 ms
  filter instead of an index lookup).
* Fixed indexes: `(form_id, field_key, value_<type>, submission_id)` for each type (partial: the value is not null),
  plus `org_path` (gist). There is no GIN index on the answers: containment (`@>`) is not leakproof either, so under RLS
  it could never serve a query (measured: 10⁵ rows scanned). A field that is not filterable is compared over the
  form's submissions in the caller's scope, bounded by the statement timeout: that is why authors mark the fields
  people filter by.
* When a newly published version makes a field filterable, the worker (system pool, on `form.published.v1`) fills its
  values for the form's existing submissions in batches. Until it is done, a filter on that field runs on the JSONB
  (still correct, only slower), and the form says so.
* The query compiler filters only on allow-listed keys: built-in columns, filterable fields through the value table,
  other fields on the answers. Every query names a form and runs under a `statement_timeout`.

## Consequences
* No runtime DDL, no owner credentials outside migrations, no write lock at publish. The schema and its indexes are
  the same in every installation, whatever the bureaus' forms are.
* Each submission costs one extra row per filterable field it answers, written in its transaction. Storage grows with
  submissions × filterable fields; authors are told to mark few fields (the lint of 0.18a can warn above a limit).
* Reports still read the registries' typed tables (architecture §6.2). The value table serves the data viewer only.
