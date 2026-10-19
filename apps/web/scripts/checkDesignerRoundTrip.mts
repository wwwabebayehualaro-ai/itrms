// The form builder (v2) opens and saves real forms without changing them.
//
//   npx tsx scripts/checkDesignerRoundTrip.mts <fixtures.json>
//
// <fixtures.json>: { versions: [{ id, name, form_config }] } (the same export as checkEngineParity.mts). For every version it
// opens the form in the builder's document and writes it back, then checks: nothing had to be fixed, every field comes back
// byte-for-byte, siblings keep their order, and the engine reads the same form. It also lists field types the builder cannot draw.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
    console.error('usage: npx tsx scripts/checkDesignerRoundTrip.mts <fixtures.json>');
    process.exit(2);
}
await import('@/form-engine/renderer/fields/registerAll');
const { fromStored, toStored } = await import('@/form-engine/designer/document');
const { readDocument } = await import('@/form-engine/core');
const { unsupportedFields } = await import('@/form-engine/renderer/kit');

const { versions } = JSON.parse(readFileSync(file, 'utf8')) as {
    versions: { id: string; name: string; form_config: any }[];
};
const stable = (v: unknown) =>
    JSON.stringify(v, (_k, x) =>
        x && typeof x === 'object' && !Array.isArray(x)
            ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
            : x
    );
const siblings = (fields: any[]) => {
    const m = new Map<string, string[]>();
    for (const f of fields) {
        const p = f.parentId === undefined || f.parentId === null || f.parentId === '' ? '' : String(f.parentId);
        m.set(p, [...(m.get(p) ?? []), String(f.id)]);
    }
    return stable(Object.fromEntries(m));
};

let fields = 0;
const issues: string[] = [];
const undrawable = new Map<string, number>();
for (const v of versions) {
    const where = `${v.name} (${v.id.slice(0, 8)})`;
    const before: any[] = Array.isArray(v.form_config) ? v.form_config : (v.form_config?.fields ?? []);
    const { doc, problems } = fromStored(v.form_config);
    const after = toStored(doc);
    fields += before.length;
    if (problems.length) issues.push(`${where}: ${problems.join('; ')}`);
    const byId = new Map(after.fields.map((f) => [String(f.id), f]));
    for (const f of before)
        if (stable(byId.get(String(f.id))) !== stable({ ...f, id: String(f.id) }))
            issues.push(`${where}: field ${f.id} changed`);
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
