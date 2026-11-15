/**
 * The draw of sampling QA (task 1.13g): exactly the share of each clerk's records, at places that cannot be foreseen.
 */
import { describe, expect, it } from 'vitest';

import { blockOf, drawStep, type DrawCounter } from '../api/sampling';

/** A repeatable random source (a linear congruential generator), for a draw a test can rerun. */
function seeded(seed: number): (below: number) => number {
    let state = seed >>> 0;
    return (below) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state % below;
    };
}

/** Draws n records at a share; the records drawn, by their place (1-based). */
function run(
    n: number,
    share: number,
    pick = seeded(7),
    from?: DrawCounter
): { drawn: number[]; counter?: DrawCounter } {
    let counter = from;
    const drawn: number[] = [];
    for (let i = 1; i <= n; i++) {
        const step = drawStep(counter, share, pick);
        counter = step.next;
        if (step.drawn) drawn.push(i);
    }
    return { drawn, ...(counter ? { counter } : {}) };
}

describe('the block a share draws from', () => {
    it('is the share in lowest terms', () => {
        expect(blockOf(0)).toEqual({ size: 1, drawn: 0 });
        expect(blockOf(5)).toEqual({ size: 20, drawn: 1 });
        expect(blockOf(7)).toEqual({ size: 100, drawn: 7 });
        expect(blockOf(30)).toEqual({ size: 10, drawn: 3 });
        expect(blockOf(100)).toEqual({ size: 1, drawn: 1 });
    });

    it('refuses a share that is not a whole percent', () => {
        expect(() => blockOf(-1)).toThrow(RangeError);
        expect(() => blockOf(101)).toThrow(RangeError);
        expect(() => blockOf(2.5)).toThrow(RangeError);
    });
});

describe('the draw', () => {
    it('draws exactly the share of every complete block', () => {
        for (const share of [5, 7, 30]) {
            const { size, drawn: k } = blockOf(share);
            const { drawn } = run(1000, share);
            expect(drawn).toHaveLength((1000 / size) * k);
            for (let block = 0; block < 1000 / size; block++)
                expect(drawn.filter((d) => d > block * size && d <= (block + 1) * size)).toHaveLength(k);
        }
    });

    it('draws every record at 100% and none at 0%', () => {
        expect(run(40, 100).drawn).toHaveLength(40);
        expect(run(40, 0).drawn).toHaveLength(0);
    });

    it('draws at places that differ from block to block and from seed to seed', () => {
        const a = run(200, 5, seeded(1)).drawn;
        const b = run(200, 5, seeded(2)).drawn;
        expect(a).not.toEqual(b);
        expect(new Set(a.map((d) => (d - 1) % 20)).size).toBeGreaterThan(1);
    });

    it('opens a block with distinct places within it', () => {
        const { next } = drawStep(undefined, 30, seeded(3));
        expect(next.blockSize).toBe(10);
        expect(new Set(next.picks).size).toBe(3);
        expect(next.picks.every((p) => p >= 1 && p <= 10)).toBe(true);
        expect(next.position).toBe(1);
    });

    it('opens a new block at the next record when the share changes, keeping what was drawn', () => {
        const before = run(7, 5, seeded(4));
        const { next } = drawStep(before.counter, 30, seeded(5));
        expect(next.share).toBe(30);
        expect(next.blockSize).toBe(10);
        expect(next.position).toBe(1);
        // the rest of the new share's blocks hold it exactly
        const after = run(19, 30, seeded(6), next);
        expect(after.drawn.length + (next.picks.includes(1) ? 1 : 0)).toBe(6);
    });

    it('carries on in the open block across calls', () => {
        const { next } = drawStep(undefined, 5, seeded(8));
        const again = drawStep(next, 5, seeded(9));
        expect(again.next.picks).toEqual(next.picks);
        expect(again.next.position).toBe(2);
    });
});
