/**
 * Ethiopic (Ge'ez) numerals, for the documents and screens that use them (optional; Arabic digits are the default). There
 * is no zero: ones ፩–፱, tens ፲–፺, ፻ (100) and ፼ (10 000). A number is written in groups of two digits, each group
 * followed by ፻ or ፼ by its place. ፩ is not written before ፻ or before the leading ፼ (፻ is 100, ፼ 10 000)...
 */

const ONES = ['', '፩', '፪', '፫', '፬', '፭', '፮', '፯', '፰', '፱'];
const TENS = ['', '፲', '፳', '፴', '፵', '፶', '፷', '፸', '፹', '፺'];
const HUNDRED = '፻';
const TEN_THOUSAND = '፼';

/** 1 → ፩, 2018 → ፳፻፲፰, 10000 → ፼. Positive integers only. */
export function toEthiopicNumeral(n: number): string {
    if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`Ethiopic numerals write positive integers, not ${n}`);
    // two-digit groups, the most significant first
    const groups: number[] = [];
    for (let rest = n; rest > 0; rest = Math.floor(rest / 100)) groups.unshift(rest % 100);
    let out = '';
    groups.forEach((group, i) => {
        const place = groups.length - 1 - i; // 0: units, 1: hundreds, 2: ten thousands, 3: millions …
        // ፩ is not written before ፻, nor before the leading ፼; it is before a later ፼ (1 010 000 is ፻፩፼, not ፻፼)
        const silentOne = group === 1 && place > 0 && (place % 2 === 1 || i === 0);
        const digits = silentOne ? '' : `${TENS[Math.floor(group / 10)]}${ONES[group % 10]}`;
        const mark = place === 0 ? '' : place % 2 === 1 ? HUNDRED : TEN_THOUSAND;
        // an empty group adds nothing, except the ፼ that carries the place of the groups before it
        if (group === 0 && mark !== TEN_THOUSAND) return;
        out += group === 0 ? mark : digits + mark;
    });
    return out;
}
