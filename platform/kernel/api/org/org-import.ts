/**
 * Org import (task 0.8, org-and-unit-types.md §5): a region's levels, unit types and units from a file, so onboarding a
 * zone is data entry, not code. One document shape, read from:
 *   YAML   the whole document (the seeds: apps/api/seed/org/*.yaml);
 *   CSV    the units of an existing region, one per row;
 *   Excel  a `units` sheet like the CSV, and optional `levels` and `unit_types` sheets.
 * The import is idempotent: what already exists (by code or key) is left as it is and counted as skipped. It runs in one
 * transaction: a file with an error changes nothing.
 */
import { i18nTextSchema, LANGUAGE_TAG, type I18nText } from '@itrms/schemas';
import { and, eq, isNull } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { insertAudited } from '../db/audit';
import type { Tx } from '../db/types';
import { ValidationError, type FieldError } from '../errors';
import { createRegion, createUnit, findUnitByCode, SERVICE_CODE } from './org-tree';
import { ORG_UNIT_KINDS, orgLevelDefinitions, orgUnits, unitTypeRoles, unitTypes, unitTypeServices } from './org.table';

const KEY = z.string().regex(/^[a-z][a-z0-9_]*$/, 'lower-case letters, digits and _');
const CODE = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/, 'letters, digits, _ . - (at most 40)');
const ROLE = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'a role key such as competency.officer');

/** `RS-01..07` or `RS-01..RS-07`: a range of codes of one process. */
export function expandServiceCodes(items: readonly string[]): string[] {
    const codes: string[] = [];
    for (const item of items) {
        const range = /^([A-Z]{2,3})-(\d{2})\.\.(?:\1-)?(\d{2})$/.exec(item);
        if (!range) {
            if (!SERVICE_CODE.test(item)) throw new Error(`"${item}" is not a service code or a range of them`);
            codes.push(item);
            continue;
        }
        const [, process = '', from = '', to = ''] = range;
        if (Number(to) < Number(from)) throw new Error(`"${item}": the range ends before it starts`);
        for (let n = Number(from); n <= Number(to); n++) codes.push(`${process}-${String(n).padStart(2, '0')}`);
    }
    return [...new Set(codes)];
}

const serviceList = z.array(z.string()).transform((items, ctx) => {
    try {
        return expandServiceCodes(items);
    } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
    }
});

export const orgImportSchema = z.strictObject({
    region: z.strictObject({
        code: CODE,
        /** needed only when the region is new */
        name: i18nTextSchema.optional(),
        toConfirm: z.array(z.string()).default([])
    }),
    levels: z.array(z.strictObject({ key: KEY, rank: z.number().int().min(1), name: i18nTextSchema })).default([]),
    unitTypes: z
        .array(
            z.strictObject({
                key: KEY,
                level: KEY,
                name: i18nTextSchema,
                categories: z.array(KEY).default([]),
                capabilities: z.array(KEY).default([]),
                services: serviceList.default([]),
                roles: z.array(ROLE).default([]),
                departments: z
                    .array(z.strictObject({ key: KEY, process: KEY.optional(), name: i18nTextSchema }))
                    .default([])
            })
        )
        .default([]),
    units: z
        .array(
            z.strictObject({
                code: CODE,
                /** the parent's code; the region when left out */
                parent: CODE.optional(),
                kind: z.enum(ORG_UNIT_KINDS),
                level: KEY,
                type: KEY.optional(),
                category: KEY.optional(),
                name: i18nTextSchema,
                toConfirm: z.array(z.string()).default([])
            })
        )
        .default([])
});

export type OrgImport = z.output<typeof orgImportSchema>;

export interface OrgImportResult {
    regionId: string;
    created: { levels: number; unitTypes: number; units: number };
    skipped: number;
}

function refuse(errors: FieldError[]): never {
    throw new ValidationError('validation_failed', { errors });
}

/** A parsed document, or 422 with every problem and where it is. */
export function validateOrgImport(input: unknown): OrgImport {
    const parsed = orgImportSchema.safeParse(input);
    if (!parsed.success)
        refuse(
            parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                code: 'invalid_value',
                message: issue.message
            }))
        );
    return parsed.data;
}

/** A YAML document; top-level `x-` keys hold anchors for the rest of the file and are not imported. */
export function parseOrgYaml(text: string): OrgImport {
    const doc: unknown = parseYaml(text);
    return validateOrgImport(
        doc && typeof doc === 'object' && !Array.isArray(doc)
            ? Object.fromEntries(Object.entries(doc).filter(([key]) => !key.startsWith('x-')))
            : doc
    );
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    // a byte-order mark (Excel writes one) is not part of the first header
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (quoted) {
            if (c === '"' && source[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && source[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else field += c;
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

type Record_ = Record<string, string>;

/** Rows with a header line as records (`name_am` → `name_am`), trimmed, empty cells left out. */
function records(rows: string[][]): Record_[] {
    const [header = [], ...body] = rows;
    const keys = header.map((h) => h.trim().toLowerCase());
    return body.map((cells) =>
        Object.fromEntries(
            keys.flatMap((key, i) => {
                const value = (cells[i] ?? '').trim();
                return key && value ? [[key, value]] : [];
            })
        )
    );
}

/** `name_am`, `name_en`, `name_wal-latn` → I18nText (the tag's case as BCP 47 writes it). */
function namesOf(record: Record_, prefix = 'name_'): Partial<I18nText> {
    const name: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
        if (!key.startsWith(prefix)) continue;
        const tag = key
            .slice(prefix.length)
            .split('-')
            .map((part, i) =>
                i === 0 ? part : part.length === 4 ? part[0]?.toUpperCase() + part.slice(1) : part.toUpperCase()
            )
            .join('-');
        if (LANGUAGE_TAG.test(tag)) name[tag] = value;
    }
    return name;
}

const list = (value: string | undefined) =>
    value
        ? value
              .split(/[;|]/)
              .map((v) => v.trim())
              .filter(Boolean)
        : [];

function unitFromRecord(r: Record_) {
    return {
        code: r.code,
        parent: r.parent,
        kind: r.kind,
        level: r.level,
        type: r.type ?? r.unit_type,
        category: r.category,
        name: namesOf(r),
        toConfirm: list(r.to_confirm)
    };
}

/** CSV of units under an existing region: code, parent, kind, level, type, category, name_am, name_en, …, to_confirm. */
export function parseOrgCsv(text: string, regionCode: string): OrgImport {
    return validateOrgImport({ region: { code: regionCode }, units: records(parseCsv(text)).map(unitFromRecord) });
}

/** An Excel workbook: a `units` sheet (as the CSV), and optional `levels` and `unit_types` sheets. */
export async function parseOrgWorkbook(data: ArrayBuffer, regionCode: string): Promise<OrgImport> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data);
    const sheet = (name: string): Record_[] => {
        const ws = workbook.getWorksheet(name);
        if (!ws) return [];
        const rows: string[][] = [];
        ws.eachRow((row) => {
            const values = Array.isArray(row.values) ? row.values.slice(1) : [];
            rows.push(values.map((v) => (v === null || v === undefined ? '' : cellText(v))));
        });
        return records(rows);
    };
    return validateOrgImport({
        region: { code: regionCode },
        levels: sheet('levels').map((r) => ({ key: r.key, rank: Number(r.rank), name: namesOf(r) })),
        unitTypes: sheet('unit_types').map((r) => ({
            key: r.key,
            level: r.level,
            name: namesOf(r),
            categories: list(r.categories),
            capabilities: list(r.capabilities),
            services: list(r.services),
            roles: list(r.roles)
        })),
        units: sheet('units').map(unitFromRecord)
    });
}

/** A cell as text: rich text joined, a formula's result, a hyperlink's text; an error cell as empty. */
function cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return cellText(value.result);
    return '';
}

/** Applies a document in the caller's transaction. */
export async function importOrg(tx: Tx, doc: OrgImport): Promise<OrgImportResult> {
    const created = { levels: 0, unitTypes: 0, units: 0 };
    let skipped = 0;

    let region = await findRegion(tx, doc.region.code);
    if (!region) {
        const root = doc.levels.find((l) => l.rank === 1);
        if (!doc.region.name || !root)
            refuse([
                {
                    path: 'region',
                    code: 'unknown_region',
                    message: `region ${doc.region.code} does not exist; a new one needs a name and a level of rank 1`
                }
            ]);
        region = await createRegion(tx, {
            code: doc.region.code,
            name: doc.region.name,
            levelKey: root.key,
            toConfirm: doc.region.toConfirm
        });
        created.units++;
    } else skipped++;
    const regionId = region.id;

    const existingLevels = await levelKeys(tx, regionId);
    for (const level of doc.levels) {
        if (existingLevels.has(level.key)) {
            skipped++;
            continue;
        }
        await insertAudited(tx, orgLevelDefinitions, { regionId, key: level.key, rank: level.rank, name: level.name });
        created.levels++;
    }

    const types = new Map(
        (await tx.select().from(unitTypes).where(eq(unitTypes.regionId, regionId))).map((t) => [t.key, t])
    );
    const levels = await levelKeys(tx, regionId);
    for (const [i, input] of doc.unitTypes.entries()) {
        if (types.has(input.key)) {
            skipped++;
            continue;
        }
        if (!levels.has(input.level))
            refuse([
                {
                    path: `unitTypes.${i}.level`,
                    code: 'unknown_level',
                    message: `"${input.level}" is not a level of this region`
                }
            ]);
        const type = await insertAudited(tx, unitTypes, {
            regionId,
            key: input.key,
            name: input.name,
            levelKey: input.level,
            categories: input.categories,
            capabilities: input.capabilities,
            departments: input.departments
        });
        for (const serviceCode of input.services)
            await insertAudited(tx, unitTypeServices, { regionId, unitTypeId: type.id, serviceCode, enabled: true });
        for (const roleKey of input.roles)
            await insertAudited(tx, unitTypeRoles, { regionId, unitTypeId: type.id, roleKey });
        types.set(type.key, type);
        created.unitTypes++;
    }

    // parents may come later in the file: place what can be placed until nothing more can
    const pending = doc.units.map((unit, index) => ({ unit, index }));
    while (pending.length > 0) {
        let placed = 0;
        for (const item of [...pending]) {
            const { unit, index } = item;
            const parent = unit.parent ? await findUnitByCode(tx, regionId, unit.parent) : region;
            if (!parent) continue;
            pending.splice(pending.indexOf(item), 1);
            placed++;
            if (await findUnitByCode(tx, regionId, unit.code)) {
                skipped++;
                continue;
            }
            const type = unit.type ? types.get(unit.type) : undefined;
            if (unit.type && !type)
                refuse([
                    {
                        path: `units.${index}.type`,
                        code: 'unknown_unit_type',
                        message: `"${unit.type}" is not a unit type of this region`
                    }
                ]);
            try {
                await createUnit(tx, {
                    parentId: parent.id,
                    kind: unit.kind,
                    levelKey: unit.level,
                    code: unit.code,
                    name: unit.name,
                    category: unit.category ?? null,
                    unitTypeId: type?.id ?? null,
                    toConfirm: unit.toConfirm
                });
            } catch (error) {
                // say which row: the tree's checks name only the field
                if (error instanceof ValidationError)
                    refuse((error.errors ?? []).map((e) => ({ ...e, path: `units.${index}.${e.path}` })));
                throw error;
            }
            created.units++;
        }
        if (placed === 0)
            refuse(
                pending.map(({ unit, index }) => ({
                    path: `units.${index}.parent`,
                    code: 'unknown_parent',
                    message: `no unit has the code "${unit.parent ?? ''}"`
                }))
            );
    }
    return { regionId, created, skipped };
}

/** A region by its code: a root unit (codes are unique within a region, so two regions may share one below the root). */
async function findRegion(tx: Tx, code: string) {
    const [region] = await tx
        .select()
        .from(orgUnits)
        .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, code)));
    return region;
}

async function levelKeys(tx: Tx, regionId: string): Promise<Set<string>> {
    const rows = await tx
        .select({ key: orgLevelDefinitions.key })
        .from(orgLevelDefinitions)
        .where(eq(orgLevelDefinitions.regionId, regionId));
    return new Set(rows.map((r) => r.key));
}
