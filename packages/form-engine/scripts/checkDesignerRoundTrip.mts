// The form builder (v2) opens and saves real forms without changing them.
//
//   pnpm --filter @itrms/form-engine check:roundtrip <fixtures.json>
//
// <fixtures.json>: { versions: [{ id, name, form_config }] } (the same export as checkEngineParity.mts). For every version it
// opens the form in the builder's document and writes it back, then checks: nothing had to be fixed, every field comes back
// byte-for-byte, siblings keep their order, and the engine reads the same form. It also lists field types the builder cannot draw.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
    console.error('usage: pnpm --filter @itrms/form-engine check:roundtrip <fixtures.json>');
    process.exit(2);
}
await import('../src/renderer/fields/registerAll');
const { fromStored, toStored } = await import('../src/designer/document');
const { readDocument } = await import('../src/core');
const { unsupportedFields } = await import('../src/renderer/kit');

type Loose = Record<string, unknown>;
const isRecord = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
// ids are strings or numbers in old forms
const text = (v: unknown) => (typeof v === 'string' ? v : (JSON.stringify(v) ?? ''));
const { versions } = JSON.parse(readFileSync(file, 'utf8')) as {
    versions: { id: string; name: string; form_config: unknown }[];
};
const stable = (v: unknown) =>
    JSON.stringify(v, (_k, x: unknown) =>
        isRecord(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x
    );
const siblings = (fields: Loose[]) => {
    const m = new Map<string, string[]>();
    for (const f of fields) {
        const p = f.parentId === undefined || f.parentId === null || f.parentId === '' ? '' : text(f.parentId);
        m.set(p, [...(m.get(p) ?? []), text(f.id)]);
    }
    return stable(Object.fromEntries(m));
};

let fields = 0;
const issues: string[] = [];
const undrawable = new Map<string, number>();
for (const v of versions) {
    const where = `${v.name} (${v.id.slice(0, 8)})`;
    const stored = isRecord(v.form_config) ? v.form_config.fields : v.form_config;
    const before = (Array.isArray(stored) ? stored : []).filter(isRecord);
    const { doc, problems } = fromStored(v.form_config);
    const after = toStored(doc);
    fields += before.length;
    if (problems.length) issues.push(`${where}: ${problems.join('; ')}`);
    const byId = new Map(after.fields.map((f) => [text(f.id), f]));
    for (const f of before)
        if (stable(byId.get(text(f.id))) !== stable({ ...f, id: text(f.id) }))
            issues.push(`${where}: field ${text(f.id)} changed`);
    if (after.fields.length !== before.length)
        issues.push(`${where}: ${before.length} fields before, ${after.fields.length} after`);
    if (siblings(before) !== siblings(after.fields))
        issues.push(`${where}: order of fields inside a container changed`);
    const engine = (x: unknown) =>
        stable(
            readDocument(x)
                .fields.map((f) => ({ ...f, source: undefined }))
                .sort((a, b) => a.id.localeCompare(b.id))
        );
    if (engine(v.form_config) !== engine(after)) issues.push(`${where}: the engine reads a different form`);
    for (const f of unsupportedFields(readDocument(after).fields))
        undrawable.set(f.type, (undrawable.get(f.type) ?? 0) + 1);
}
console.log(`${versions.length} form versions, ${fields} fields: ${issues.length} differences`);
issues.forEach((i) => console.log(`- ${i}`));
console.log(
    undrawable.size
        ? `field types the builder cannot draw: ${[...undrawable].map(([t, n]) => `${t} (${n})`).join(', ')}`
        : 'the builder can draw every field'
);
process.exit(issues.length ? 1 : 0);
