# Leave Request — a small reference form

`leave-request.template.json`: Employee, Leave type, First day, Days, Half day, Reason. Seeded with the demo data
(`../demo/seed-demo.cjs`); it has a date, so its requests page offers the Calendar view. Filled in a real browser by
`tests/e2e/fill-form.spec.ts`; building a form from nothing is `tests/e2e/builder.spec.ts`.
