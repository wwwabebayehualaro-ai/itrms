// Runtime engine regression checks (bindings, mapping, request building, formulas):  pnpm --filter @itrms/form-engine check:runtime
import assert from 'node:assert/strict';
const { resolveBindings, resolveString, extractReferences, getByPath } = await import('../src/core/runtime/expression');
const { toOptions, applyResponseMapping, mapError } = await import('../src/core/runtime/mapping');
const { prepareRequest, isEnabled, getDependencies } = await import('../src/renderer/runtime/dataSourceClient');

const ctx: any = {
    form: { branchId: 7, name: '{{user.id}}', empty: '' },
    data: { customers: [{ id: 1, name: 'A' }] },
    user: { id: 'u1' },
    route: { id: '42' },
    variables: { v: 'x' }
};
assert.equal(resolveString('{{form.branchId}}', ctx), 7); // type preserved
assert.equal(resolveString('/c/{{route.id}}/b/{{form.branchId}}', ctx), '/c/42/b/7');
assert.equal(resolveString('{{form.missing | default:"d"}}', ctx), 'd');
assert.equal(resolveString('{{form.missing}}', ctx), undefined);
assert.equal(resolveString('a{{form.missing}}b', ctx), 'ab');
assert.equal(resolveString('{{form.name}}', ctx), '{{user.id}}'); // single pass: user input never re-evaluated
assert.equal(getByPath({}, '__proto__.polluted'), undefined);
assert.equal(resolveString('{{constructor.name}}', ctx), undefined);
assert.equal(resolveString('{{data.customers[0].name}}', ctx), 'A');
assert.deepEqual([...extractReferences({ a: '{{form.x}}', b: ['{{route.id | default:1}}'] })], ['form.x']);

const opts = toOptions(
    { data: { items: [{ id: 1, title: 'One', off: true, kids: [{ id: 2, title: 'Two' }] }] } },
    { itemsPath: 'data.items', labelPath: 'title', valuePath: 'id', disabledPath: 'off', childrenPath: 'kids' }
);
assert.equal(opts[0]?.label, 'One');
assert.equal(opts[0]?.disabled, true);
assert.equal(opts[0]?.items?.[0]?.value, 2);
assert.deepEqual(
    toOptions(['a', 'b']).map((o) => o.value),
    ['a', 'b']
);
assert.deepEqual(toOptions(null), []);

assert.deepEqual(
    applyResponseMapping(
        {
            data: [
                { a: 1, active: true },
                { a: 2, active: false }
            ]
        },
        { path: 'data', transforms: [{ op: 'filter', where: { field: 'active', operator: 'eq', value: true } as any }] }
    ),
    [{ a: 1, active: true }]
);

const ds: any = {
    id: 'c',
    request: {
        method: 'GET',
        url: '/customers/{customerId}',
        pathParams: { customerId: '{{form.branchId}}' },
        query: { q: '{{form.empty}}', b: '{{form.branchId}}' },
        headers: { Authorization: 'x', 'Idempotency-Key': 'fixed', 'X-T': '{{user.id}}' }
    }
};
const p = prepareRequest(ds, ctx);
assert.equal(p.config.url, '/customers/7');
assert.deepEqual(p.config.params, { b: 7 });
assert.deepEqual(p.config.headers, { 'X-T': 'u1' });
assert.throws(() => prepareRequest({ ...ds, request: { ...ds.request, url: 'https://evil.com/x' } }, ctx), /Absolute/);
assert.throws(() => prepareRequest({ ...ds, request: { ...ds.request, url: '//evil.com' } }, ctx), /Absolute/);
assert.throws(() => prepareRequest({ ...ds, request: { ...ds.request, url: '/a/../b' } }, ctx), /traversal/);
const post: any = { id: 'p', request: { method: 'POST', url: '/s', body: { q: '{{form.branchId}}' } } };
assert.deepEqual(prepareRequest(post, ctx).config.data, { q: 7 });
assert.deepEqual(prepareRequest(post, ctx, { note: '{{user.id}}' }).config.data, { note: '{{user.id}}' }); // override verbatim

const dep: any = { id: 'd', request: { method: 'GET', url: '/x?b={{form.nope}}' } };
assert.equal(isEnabled(dep, ctx), false);
assert.deepEqual(getDependencies(dep), ['form.nope']);
assert.equal(
    isEnabled(
        {
            ...dep,
            request: { method: 'GET', url: '/x' },
            enabledWhen: [{ field: 'user.id', operator: 'eq', value: 'u1' }]
        },
        ctx
    ),
    true
);
assert.equal(
    mapError({ response: { status: 404, data: { detail: 'nf' } } }, { statusMessages: { '404': 'Missing' } }),
    'Missing'
);
assert.equal(mapError({ response: { status: 400, data: { detail: 'bad' } } }), 'bad');

const { evalFormula, checkFormula } = await import('../src/core/runtime/formula');
{
    // ---- formulas
    const ctx: any = {
        row: { qty: 3, price: 19.99, tax: '10', name: '' },
        root: { lines: [{ total: 10.5 }, { total: '4.25' }, { total: null }, {}], n: 4, flag: true },
        user: { name: 'Ann' }
    };
    const f = (s: string) => evalFormula(s, ctx);
    assert.equal(f('1 + 2 * 3'), 7);
    assert.equal(f('(1 + 2) * 3'), 9);
    assert.equal(f('-2 * -3'), 6);
    assert.equal(f('10 % 4'), 2);
    assert.equal(f('row.qty * row.price'), (59.97 as any) === 59.97 ? f('row.qty * row.price') : 0);
    assert.equal(f('round(row.qty * row.price * (1 + row.tax / 100), 2)'), 65.97);
    assert.equal(f("sum(root.lines, 'total')"), 14.75);
    assert.equal(f('count(root.lines)'), 4);
    assert.equal(f("avg(root.lines, 'total')"), 14.75 / 4);
    assert.equal(f('row.name * 5'), 0); // empty -> 0, spreadsheet style
    assert.equal(f('row.missing + 1'), 1);
    assert.equal(f('1 / 0'), null); // no Infinity leaks out
    assert.equal(f("row.qty > 2 ? 'bulk' : 'single'"), 'bulk');
    assert.equal(f('root.n >= 4 && root.flag'), true);
    assert.equal(f('!root.flag'), false);
    assert.equal(f("concat(user.name, ' has ', row.qty)"), 'Ann has 3');
    assert.equal(f("if(isEmpty(row.name), 'n/a', row.name)"), 'n/a');
    assert.equal(f('coalesce(row.name, user.name)'), 'Ann');
    assert.equal(f('max(1, 5, 3)'), 5);
    assert.equal(f('min(root.lines)'), 0);
    assert.equal(f("'a' + 'b'"), 'ab');
    // safety
    assert.equal(f('constructor.constructor("return 1")()'), undefined);
    assert.equal(f('row.__proto__'), undefined);
    assert.equal(f('process.exit(1)'), undefined); // unknown function
    assert.equal(f('x['), undefined);
    assert.equal(f('1 +'), undefined);
    assert.equal(f('a'.repeat(501)), undefined);
    assert.equal(f('('.repeat(60) + '1' + ')'.repeat(60)), undefined); // depth bound
    assert.ok(checkFormula('1 +'));
    assert.equal(checkFormula('row.a * 2'), null);
    // through the binding layer
    assert.equal(resolveString('{{= row.qty * 2 }}', ctx), 6); // type preserved
    assert.equal(resolveString('Total: {{= round(sum(root.lines, "total"), 1) }} EUR', ctx), 'Total: 14.8 EUR');
    assert.deepEqual(resolveBindings({ a: '{{= row.qty + 1 }}' }, ctx), { a: 4 });
    assert.deepEqual([...extractReferences('{{= sum(root.lines, "total") * row.qty }}')].sort(), [
        'root.lines',
        'row.qty'
    ]);
}
console.log('runtime engine ok');
