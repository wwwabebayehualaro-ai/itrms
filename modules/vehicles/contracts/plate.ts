/**
 * Number plates (ethiopia-context.md §2, Directive 1050/2025). The national plate is `ETH` (`ኢት`), three Latin letters and
 * four digits. The plates it replaces were regional: a use code (1 to 5), a region code in Latin or Ethiopic letters, an
 * optional series letter and four to six digits, written in whatever order the plate and its owner's habit gave. Diplomatic,
 * international-organisation and police plates carry their own prefix. Each plate has one key (upper case, no spaces, dots or
 * hyphens), which is what is stored, made unique and searched.
 */

export const PLATE_FORMATS = ['national', 'legacy', 'special'] as const;
export type PlateFormat = (typeof PLATE_FORMATS)[number];

/** A region's old plate code in Latin letters, and the Ethiopic writings of it that plates and people use. */
export interface LegacyPlateRegion {
    code: string;
    aliases: string[];
}

/**
 * The codes of the regions' old plates, as ITRMS starts out; a region adjusts them with the `vehicles.legacy_plate_regions`
 * setting. A stated assumption (the plates are not catalogued in a published text): check against the region's own records.
 */
export const DEFAULT_LEGACY_PLATE_REGIONS: readonly LegacyPlateRegion[] = [
    { code: 'AA', aliases: ['አአ', 'አዲስአበባ'] },
    { code: 'DD', aliases: ['ድሬ', 'ድሬዳዋ'] },
    { code: 'OR', aliases: ['ኦሮ', 'ኦሮሚያ'] },
    { code: 'AM', aliases: ['አማ', 'አማራ'] },
    { code: 'TG', aliases: ['ትግ', 'ትግራይ'] },
    { code: 'SO', aliases: ['ሶማ', 'ሶማሌ'] },
    { code: 'AF', aliases: ['አፋ', 'አፋር'] },
    { code: 'BG', aliases: ['ቤጉ', 'ቤንሻንጉል'] },
    { code: 'GM', aliases: ['ጋም', 'ጋምቤላ'] },
    { code: 'HR', aliases: ['ሐረ', 'ሀረ', 'ሀረሪ'] },
    { code: 'SN', aliases: ['ደቡ', 'ደብ', 'ደቡብ'] },
    { code: 'SD', aliases: ['ሲዳ', 'ሲዳማ'] },
    { code: 'CW', aliases: ['ማዕ'] },
    { code: 'SW', aliases: ['ደም'] }
];

export interface ParsedPlate {
    format: PlateFormat;
    /** stored, unique and searched: `ETHABC1234`, `L3ORA12345`, `CD123` */
    key: string;
    /** as it is written on the plate */
    text: string;
    useCode: number | null;
    regionCode: string | null;
}

const SEPARATORS = /[\s\-./_]/g;
const SPECIAL_PREFIXES: Record<string, string> = { CD: 'CD', AU: 'AU', UN: 'UN', POLICE: 'POLICE', ፖሊስ: 'POLICE' };

/** The plate text folded: Unicode-normalised, upper case, without spaces, dots, hyphens or slashes, `ኢት` read as `ETH`. */
export function foldPlate(raw: string): string {
    const folded = raw.normalize('NFKC').toUpperCase().replace(SEPARATORS, '');
    return folded.startsWith('ኢት') ? `ETH${folded.slice('ኢት'.length)}` : folded;
}

/** The national plate as written in Latin or in Ethiopic letters. */
export function nationalPlateText(key: string, script: 'latin' | 'ethiopic' = 'latin'): string {
    return `${script === 'ethiopic' ? 'ኢት' : 'ETH'} ${key.slice(3, 6)} ${key.slice(6)}`;
}

// Latin only: the key is letters and digits A-Z0-9 (an Ethiopic series letter is not a plate this register can hold)
const SERIES = '[A-Z]';
const LEGACY_REST = new RegExp(`^([1-5])(${SERIES})?([0-9]{4,6})$`);

/**
 * What a plate is, or null when it is none of the formats. The legacy region codes come from the setting (Latin code and
 * Ethiopic aliases); the region's code may stand before, between or after the rest.
 */
export function parsePlate(
    raw: string,
    regions: readonly LegacyPlateRegion[] = DEFAULT_LEGACY_PLATE_REGIONS
): ParsedPlate | null {
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- every pattern below is anchored with bounded classes; input capped at 40
    const folded = foldPlate(raw);
    if (folded === '' || folded.length > 40) return null;

    if (/^ETH[A-Z]{3}[0-9]{4}$/.test(folded))
        return { format: 'national', key: folded, text: nationalPlateText(folded), useCode: null, regionCode: null };

    const special = /^(CD|AU|UN|POLICE|ፖሊስ)([0-9]{1,6})$/u.exec(folded);
    if (special) {
        const prefix = SPECIAL_PREFIXES[special[1] ?? ''] ?? '';
        const key = `${prefix}${special[2] ?? ''}`;
        return { format: 'special', key, text: `${prefix} ${special[2] ?? ''}`, useCode: null, regionCode: null };
    }

    // every reading of the plate: each spelling of each region, wherever it stands. A spelling that folds to nothing (an alias of
    // only separators) is no spelling: `indexOf('')` would match everywhere, for ever.
    const readings = new Map<string, ParsedPlate & { whole: boolean }>();
    const bounds = tokenBounds(raw, folded);
    for (const r of regions) {
        const code = r.code.toUpperCase();
        for (const spelling of new Set([r.code, ...r.aliases].map(foldPlate)))
            for (let at = spelling ? folded.indexOf(spelling) : -1; at >= 0; at = folded.indexOf(spelling, at + 1)) {
                const rest = LEGACY_REST.exec(folded.slice(0, at) + folded.slice(at + spelling.length));
                if (!rest) continue;
                const [, use = '', series = '', digits = ''] = rest;
                const key = `L${use}${code}${series}${digits}`;
                const whole = bounds.has(at) && bounds.has(at + spelling.length);
                const seen = readings.get(key);
                if (!seen || (whole && !seen.whole))
                    readings.set(key, {
                        format: 'legacy',
                        key,
                        text: `${code} ${use}-${series}${digits}`,
                        useCode: Number(use),
                        regionCode: code,
                        whole
                    });
            }
    }
    // one reading is the plate. Several (`3SOR1234`: Somali series R, or Oromia series S) are told apart only by the region
    // standing apart as written (`3-SO-R1234`); a plate still ambiguous is refused, never guessed.
    const all = [...readings.values()];
    const apart = all.filter((r) => r.whole);
    const chosen = all.length === 1 ? all[0] : apart.length === 1 ? apart[0] : undefined;
    if (!chosen) return null;
    return {
        format: chosen.format,
        key: chosen.key,
        text: chosen.text,
        useCode: chosen.useCode,
        regionCode: chosen.regionCode
    };
}

/**
 * Where the plate's parts begin and end in its folded text: at its start and end, where a separator stood, and where digits
 * meet letters. Used to tell which region code stands apart.
 */
function tokenBounds(raw: string, folded: string): Set<number> {
    const bounds = new Set([0, folded.length]);
    let text = '';
    for (const char of raw.normalize('NFKC').toUpperCase()) {
        if (char.trim() === '' || SEPARATOR_CHARS.has(char)) bounds.add(text.length);
        else text += char;
    }
    // the folding also reads `ኢት` as `ETH`: then the positions of the raw text are not the folded one's
    if (text !== folded) for (const b of [...bounds]) if (b !== 0 && b !== folded.length) bounds.delete(b);
    for (let i = 1; i < folded.length; i += 1) if (isDigit(folded[i - 1]) !== isDigit(folded[i])) bounds.add(i);
    return bounds;
}

const SEPARATOR_CHARS = new Set(['-', '.', '/', '_']);
const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9';
