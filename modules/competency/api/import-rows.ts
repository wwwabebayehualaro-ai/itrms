/**
 * A sheet's row as a back-capture (task 1.13b): its cells read into the answers MIG-01 takes for one paper file, and every error
 * of its cells at once (a date that is not one, a number that is not one, a value that is not one of the list, a missing column).
 * The register's own rules run on what this gives (BackCaptureService.check). Pure: no database, no context.
 */
import { isValidEthiopianDate, isValidGregorianDate, toGregorian, isoDate } from '@itrms/ethiopian-calendar';
import { ethiopicNameSchema, finSchema, latinNameSchema, phoneSchema, type SEXES } from '@itrms/parties/contracts';
import { CHASSIS_KINDS, FUELS, VEHICLE_USES } from '@itrms/vehicles/contracts';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import { IMPORT_COLUMNS } from '../contracts';
import type { BackCaptureInput } from './back-capture.service';
import { DATE_CELL } from './import-sheet';

/** An error of a cell, by its code: the message is the catalogue's `competency.import.error.<code>`. */
export interface CellError {
    column: string | null;
    code: string;
    params?: Record<string, string>;
}

/** The owner a row names: a person (made or found at the commit) or an organisation already on the register. */
export type ImportOwner =
    | {
          kind: 'person';
          nameAm: { given: string; father: string; grandfather?: string };
          nameEn?: { given: string; father: string; grandfather?: string };
          sex: (typeof SEXES)[number];
      }
    | { kind: 'organisation'; tin: string };

/** The owner's phone and FIN: kept apart from the row's facts, encrypted. */
export interface ImportSensitive {
    phone?: string;
    fin?: string;
}

/** The capture's answers without its owners (the owner is resolved at the check and the commit) and without its scan. */
export type ImportValues = Omit<BackCaptureInput, 'owners'> & { category: string; scanFile?: string };

export type ReadRow =
    | { ok: true; values: ImportValues; owner: ImportOwner; sensitive: ImportSensitive }
    | { ok: false; errors: CellError[]; paperReference?: string };

const fold = (text: string) => text.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

/** A list's value by its key or by its label in Amharic or English, folded. */
function vocabulary<K extends string>(keys: readonly K[], prefix: string): (text: string) => K | undefined {
    const map = new Map<string, K>();
    for (const key of keys) {
        map.set(fold(key), key);
        for (const words of [vehiclesAm, vehiclesEn] as Record<string, string>[]) {
            const label = words[`${prefix}.${key}`];
            if (label) map.set(fold(label), key);
        }
    }
    return (text) => map.get(fold(text));
}
const useOf = vocabulary(VEHICLE_USES, 'vehicles.use');
const fuelOf = vocabulary(FUELS, 'vehicles.fuel');
const SEX_WORDS: Record<string, (typeof SEXES)[number]> = {
    female: 'female',
    f: 'female',
    ሴት: 'female',
    male: 'male',
    m: 'male',
    ወንድ: 'male'
};

/**
 * A date as the paper gives it: Ethiopian `dd/mm/yyyy` (also with `-` or `.`), or Gregorian ISO `yyyy-mm-dd`; the Gregorian ISO
 * day it is, or undefined.
 */
export function readDate(text: string): string | undefined {
    const ethiopian = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (ethiopian) {
        const date = { day: Number(ethiopian[1]), month: Number(ethiopian[2]), year: Number(ethiopian[3]) };
        return isValidEthiopianDate(date) ? isoDate(toGregorian(date)) : undefined;
    }
    const gregorian = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (gregorian) {
        const date = { year: Number(gregorian[1]), month: Number(gregorian[2]), day: Number(gregorian[3]) };
        return isValidGregorianDate(date) ? isoDate(date) : undefined;
    }
    return undefined;
}

/** A name as one cell: the given name, the father's and, when there, the grandfather's, separated by spaces. */
function nameParts(text: string): { given: string; father: string; grandfather?: string } | undefined {
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return undefined;
    const [given = '', father = '', grandfather] = parts;
    return grandfather ? { given, father, grandfather } : { given, father };
}

const NUMBER_COLUMNS: Record<string, keyof ImportValues> = {
    model_year: 'modelYear',
    seats: 'seats',
    load_capacity_kg: 'loadCapacityKg',
    gross_weight_kg: 'grossWeightKg',
    engine_cc: 'engineCc',
    axles: 'axles'
};
const DATE_COLUMNS: Record<string, keyof ImportValues> = {
    first_registered_on: 'firstRegisteredOn',
    owners_since: 'ownersSince',
    plate_since: 'plateSince',
    libre_issued_on: 'libreIssuedOn'
};
const TEXT_COLUMNS: Record<string, [keyof ImportValues, number]> = {
    paper_reference: ['paperReference', 60],
    scan_file: ['scanFile', 200],
    plate: ['plate', 40],
    libre_number: ['libreNumber', 40],
    federal_vehicle_id: ['federalVehicleId', 40],
    chassis_number: ['chassisNumber', 40],
    engine_number: ['engineNumber', 30],
    make: ['make', 60],
    model: ['model', 60],
    category: ['category', 120],
    colour: ['colour', 30]
};

/** The capture a row gives, or every error of its cells. */
export function readRow(cells: Readonly<Record<string, string>>): ReadRow {
    const errors: CellError[] = [];
    const values: Record<string, unknown> = {};
    for (const column of IMPORT_COLUMNS)
        if (column.required && !cells[column.key]) errors.push({ column: column.key, code: 'required' });
    for (const [column, text] of Object.entries(cells)) {
        if (text === DATE_CELL) {
            errors.push({ column, code: 'date_cell' });
            continue;
        }
        const date = DATE_COLUMNS[column];
        if (date) {
            const day = readDate(text);
            if (day) values[date] = day;
            else errors.push({ column, code: 'invalid_date' });
            continue;
        }
        const number = NUMBER_COLUMNS[column];
        if (number) {
            if (/^\d{1,9}$/.test(text)) values[number] = Number(text);
            else errors.push({ column, code: 'invalid_number' });
            continue;
        }
        const field = TEXT_COLUMNS[column];
        if (field) {
            const [key, max] = field;
            if (text.length > max) errors.push({ column, code: 'too_long', params: { max: String(max) } });
            else values[key] = text;
        }
    }
    if (cells.use) {
        const use = useOf(cells.use);
        if (use) values.use = use;
        else errors.push({ column: 'use', code: 'not_in_list' });
    }
    if (cells.fuel) {
        const fuel = fuelOf(cells.fuel);
        if (fuel) values.fuel = fuel;
        else errors.push({ column: 'fuel', code: 'not_in_list' });
    }
    if (cells.chassis_kind) {
        const kind = CHASSIS_KINDS.find((k) => k === fold(cells.chassis_kind ?? ''));
        if (kind) values.chassisKind = kind;
        else errors.push({ column: 'chassis_kind', code: 'not_in_list' });
    }

    const { owner, sensitive } = readOwner(cells, errors);
    if (errors.length > 0 || !owner)
        return {
            ok: false,
            errors,
            ...(cells.paper_reference ? { paperReference: cells.paper_reference.slice(0, 60) } : {})
        };
    return { ok: true, values: values as ImportValues, owner, sensitive };
}

function readOwner(
    cells: Readonly<Record<string, string>>,
    errors: CellError[]
): { owner?: ImportOwner; sensitive: ImportSensitive } {
    const sensitive: ImportSensitive = {};
    const person = Boolean(cells.owner_name_am || cells.owner_name_en || cells.owner_sex);
    if (cells.owner_tin) {
        if (person || cells.owner_phone || cells.owner_fin) {
            errors.push({ column: 'owner_tin', code: 'owner_one_of' });
            return { sensitive };
        }
        if (!/^\d{10}$/.test(cells.owner_tin)) {
            errors.push({ column: 'owner_tin', code: 'invalid_tin' });
            return { sensitive };
        }
        return { owner: { kind: 'organisation', tin: cells.owner_tin }, sensitive };
    }
    if (!cells.owner_name_am) {
        errors.push({ column: 'owner_name_am', code: person ? 'required' : 'owner_required' });
        return { sensitive };
    }
    let failed = false;
    const am = nameParts(cells.owner_name_am);
    const nameAm = am && ethiopicNameSchema.safeParse(am);
    if (!nameAm?.success) {
        errors.push({ column: 'owner_name_am', code: 'invalid_name' });
        failed = true;
    }
    let nameEn: ReturnType<typeof latinNameSchema.parse> | undefined;
    if (cells.owner_name_en) {
        const en = nameParts(cells.owner_name_en);
        const parsed = en && latinNameSchema.safeParse(en);
        if (parsed?.success) nameEn = parsed.data;
        else {
            errors.push({ column: 'owner_name_en', code: 'invalid_name' });
            failed = true;
        }
    }
    const sex = cells.owner_sex ? SEX_WORDS[fold(cells.owner_sex)] : undefined;
    if (!sex) {
        errors.push({ column: 'owner_sex', code: cells.owner_sex ? 'not_in_list' : 'required' });
        failed = true;
    }
    if (cells.owner_phone) {
        const phone = phoneSchema.safeParse(cells.owner_phone);
        if (phone.success) sensitive.phone = phone.data;
        else {
            errors.push({ column: 'owner_phone', code: 'invalid_phone' });
            failed = true;
        }
    }
    if (cells.owner_fin) {
        const fin = finSchema.safeParse(cells.owner_fin);
        if (fin.success) sensitive.fin = fin.data;
        else {
            errors.push({ column: 'owner_fin', code: 'invalid_fin' });
            failed = true;
        }
    }
    if (failed || !nameAm?.success || !sex) return { sensitive };
    return {
        owner: { kind: 'person', nameAm: nameAm.data, ...(nameEn ? { nameEn } : {}), sex },
        sensitive
    };
}

/**
 * What makes two rows' owners one person: the FIN, else the Amharic name with the phone. A name alone does not (many people share
 * one), so a row without either gets a person of its own. Undefined for an organisation, which is found by its TIN.
 */
export function ownerKeyOf(owner: ImportOwner, sensitive: ImportSensitive): string | undefined {
    if (owner.kind !== 'person') return undefined;
    if (sensitive.fin) return `fin:${sensitive.fin}`;
    if (!sensitive.phone) return undefined;
    const { given, father, grandfather } = owner.nameAm;
    return `name:${fold([given, father, grandfather ?? ''].join(' '))}|phone:${sensitive.phone}`;
}

/** The register's paths (BackCaptureService, VehicleRegistry) as the sheet's columns. */
export const COLUMN_OF_PATH: Readonly<Record<string, string>> = {
    paperReference: 'paper_reference',
    firstRegisteredOn: 'first_registered_on',
    ownersSince: 'owners_since',
    since: 'owners_since',
    plate: 'plate',
    plateSince: 'plate_since',
    libreNumber: 'libre_number',
    libreIssuedOn: 'libre_issued_on',
    federalVehicleId: 'federal_vehicle_id',
    federalIdSource: 'federal_vehicle_id',
    chassisNumber: 'chassis_number',
    chassisKind: 'chassis_kind',
    engineNumber: 'engine_number',
    make: 'make',
    model: 'model',
    modelYear: 'model_year',
    categoryKey: 'category',
    use: 'use',
    seats: 'seats',
    loadCapacityKg: 'load_capacity_kg',
    grossWeightKg: 'gross_weight_kg',
    engineCc: 'engine_cc',
    axles: 'axles',
    colour: 'colour',
    fuel: 'fuel',
    owners: 'owner_name_am'
};

/**
 * The column a register path is at: its first segment (`owners.0.id` is the owner's); a person's FIN or phone (`sensitive.fin`)
 * and the duplicates a new person would have are the owner's columns.
 */
export function columnOfPath(path: string | undefined): string | null {
    if (!path) return null;
    const [first = '', second = ''] = path.split('.');
    if (first === 'sensitive')
        return second === 'fin' ? 'owner_fin' : second === 'phone' ? 'owner_phone' : 'owner_name_am';
    if (first === 'acknowledgedDuplicates' || first === 'nameAm') return 'owner_name_am';
    if (first === 'nameEn') return 'owner_name_en';
    return COLUMN_OF_PATH[first] ?? null;
}
