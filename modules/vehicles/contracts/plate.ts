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

    // every spelling of every region, the longest first so `AA` is read before a series letter `A`
    const spellings = regions
        .flatMap((r) => [r.code, ...r.aliases].map((a) => ({ spelling: foldPlate(a), code: r.code.toUpperCase() })))
        .sort((a, b) => b.spelling.length - a.spelling.length);
    for (const { spelling, code } of spellings) {
        for (let at = folded.indexOf(spelling); at >= 0; at = folded.indexOf(spelling, at + 1)) {
            const rest = LEGACY_REST.exec(folded.slice(0, at) + folded.slice(at + spelling.length));
            if (!rest) continue;
            const [, use = '', series = '', digits = ''] = rest;
            return {
                format: 'legacy',
                key: `L${use}${code}${series}${digits}`,
                text: `${code} ${use}-${series}${digits}`,
                useCode: Number(use),
                regionCode: code
            };
        }
    }
    return null;
}
