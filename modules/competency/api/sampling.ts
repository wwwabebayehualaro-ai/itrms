/**
 * The draw of sampling QA (task 1.13g, ADR-0054 §3): which of a clerk's migrated records are re-checked. A share of p percent is
 * drawn as k of every block of n records (k/n = p/100 in lowest terms: 5% is 1 in 20, 30% is 3 in 10, 7% is 7 in 100), the k
 * places in each block chosen at random when it opens. Every complete block draws exactly k, so the share holds per clerk and
 * cannot be foreseen. A change of the share opens a new block at the next record: records drawn stay drawn.
 */
import { randomInt } from 'node:crypto';

/** Where a clerk's draw stands: the share its block was opened with, its size, the records of it so far and its drawn places. */
export interface DrawCounter {
    share: number;
    blockSize: number;
    position: number;
    picks: number[];
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The block a share draws from: its size, and how many of it are drawn. */
export function blockOf(percent: number): { size: number; drawn: number } {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new RangeError(`share ${percent}`);
    if (percent === 0) return { size: 1, drawn: 0 };
    const g = gcd(percent, 100);
    return { size: 100 / g, drawn: percent / g };
}

/** k distinct places of 1..size, at random (a partial Fisher–Yates shuffle). */
function places(size: number, k: number, pick: (below: number) => number): number[] {
    const all = Array.from({ length: size }, (_, i) => i + 1);
    for (let i = 0; i < k; i++) {
        const j = i + pick(size - i);
        [all[i], all[j]] = [all[j] as number, all[i] as number];
    }
    return all.slice(0, k).sort((a, b) => a - b);
}

function newBlock(share: number, pick: (below: number) => number): DrawCounter {
    const { size, drawn } = blockOf(share);
    return { share, blockSize: size, position: 0, picks: places(size, drawn, pick) };
}

/**
 * One more record of a clerk: whether it is drawn, and the counter after it. A block opens for the first record, after a complete
 * block, and when the share is not the one the open block was made with.
 */
export function drawStep(
    counter: DrawCounter | undefined,
    share: number,
    pick: (below: number) => number = (below) => randomInt(below)
): { next: DrawCounter; drawn: boolean } {
    const open = counter && counter.share === share && counter.position < counter.blockSize ? counter : undefined;
    const block = open ?? newBlock(share, pick);
    const position = block.position + 1;
    return { next: { ...block, position }, drawn: block.picks.includes(position) };
}
