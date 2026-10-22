/**
 * Phonetic Latin → Ethiopic (Fidel), for typing Amharic (and Tigrinya) on a PC without an Ethiopic keyboard layout (task
 * 0.13). A consonant letter, then a vowel that picks the syllable's order:
 *
 *   e → 1st (ä: ለ)   u → 2nd (ሉ)   i → 3rd (ሊ)   a → 4th (ላ)   ie or E → 5th (ሌ)   none → 6th (ል)   o → 7th (ሎ)
 *   wa → the labialised form (ሏ) where the series has one
 *
 * Consonants follow SERA where it is short: h ሀ, l ለ, H ሐ, m መ, r ረ, s ሰ, x or sh ሸ, q ቀ, b በ, v ቨ, t ተ, c or ch ቸ,
 * n ነ, N or ny or gn ኘ, k ከ, K or kh ኸ, w ወ, z ዘ, Z or zh ዠ, y የ, d ደ, j ጀ, g ገ, T ጠ, C ጨ, P ጰ, S or ts ጸ, f ፈ, p ፐ;
 * ' and ` start a vowel on አ and ዐ. A vowel alone is written on አ (a አ, u ኡ, i ኢ, A ኣ, E ኤ, e እ, o ኦ).
 */

const CONSONANTS: Readonly<Record<string, number>> = {
    h: 0x1200,
    l: 0x1208,
    H: 0x1210,
    m: 0x1218,
    r: 0x1228,
    s: 0x1230,
    x: 0x1238,
    sh: 0x1238,
    q: 0x1240,
    b: 0x1260,
    v: 0x1268,
    t: 0x1270,
    c: 0x1278,
    ch: 0x1278,
    n: 0x1290,
    N: 0x1298,
    ny: 0x1298,
    gn: 0x1298,
    "'": 0x12a0,
    k: 0x12a8,
    K: 0x12b8,
    kh: 0x12b8,
    w: 0x12c8,
    '`': 0x12d0,
    z: 0x12d8,
    Z: 0x12e0,
    zh: 0x12e0,
    y: 0x12e8,
    d: 0x12f0,
    j: 0x1300,
    g: 0x1308,
    T: 0x1320,
    C: 0x1328,
    P: 0x1330,
    S: 0x1338,
    ts: 0x1338,
    f: 0x1348,
    p: 0x1350
};

/** The series whose labialised form (ሏ, ሟ …) is at base + 7 (ቋ, ኳ, ጓ sit apart, in blocks of their own). */
const LABIALISED = new Set([
    0x1208, 0x1210, 0x1218, 0x1228, 0x1230, 0x1238, 0x1260, 0x1268, 0x1270, 0x1278, 0x1290, 0x1298, 0x12d8, 0x12e0,
    0x12f0, 0x1300, 0x1320, 0x1328, 0x1330, 0x1338, 0x1348, 0x1350
]);

/** The vowel after a consonant → the order's offset from the series' first letter. */
const ORDERS: readonly [string, number][] = [
    ['ie', 4],
    ['e', 0],
    ['u', 1],
    ['i', 2],
    ['a', 3],
    ['E', 4],
    ['o', 6]
];

const STANDALONE: Readonly<Record<string, string>> = { a: 'አ', u: 'ኡ', i: 'ኢ', A: 'ኣ', E: 'ኤ', e: 'እ', o: 'ኦ' };

const DIGRAPHS = ['sh', 'ch', 'ts', 'ny', 'gn', 'kh', 'zh'];

/** The Ethiopic of a run of Latin letters; anything it does not know is kept as it is. */
export function transliterate(latin: string): string {
    let out = '';
    let i = 0;
    while (i < latin.length) {
        const pair = latin.slice(i, i + 2);
        const consonant = DIGRAPHS.includes(pair) ? pair : (latin[i] ?? '');
        const base = CONSONANTS[consonant];
        if (base === undefined) {
            const vowel = latin[i] ?? '';
            out += STANDALONE[vowel] ?? vowel;
            i += 1;
            continue;
        }
        i += consonant.length;
        if (latin.startsWith('wa', i) && LABIALISED.has(base)) {
            out += String.fromCodePoint(base + 7);
            i += 2;
            continue;
        }
        const order = ORDERS.find(([vowel]) => latin.startsWith(vowel, i));
        out += String.fromCodePoint(base + (order ? order[1] : 5));
        i += order ? order[0].length : 0;
    }
    return out;
}

/** Latin letters (and ' `) that take part in a word being typed. */
export const isLatinWordChar = (char: string): boolean => /^[A-Za-z'`]$/.test(char);

/** Ethiopic punctuation for the keys typed alone: , → ፣ ; → ፤ (and :: → ። by the typing hook). */
export const PUNCTUATION: Readonly<Record<string, string>> = { ',': '፣', ';': '፤', '?': '?' };
