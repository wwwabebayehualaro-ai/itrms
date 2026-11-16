/**
 * The arithmetic of campaign counters (task 1.13i): the pace expected so far, being on track, the zero-filled series and the totals.
 */
import { describe, expect, it } from 'vitest';

import { campaignCreateSchema, spanDays } from '../contracts';
import { elapsedDays, expectedBy, onTrack, seriesOf, totalsOf } from '../api/campaigns';

describe('spanDays', () => {
    it('counts both ends', () => {
        expect(spanDays('2026-11-01', '2026-11-01')).toBe(1);
        expect(spanDays('2026-11-01', '2026-11-30')).toBe(30);
        expect(spanDays('2027-01-01', '2026-12-31')).toBe(0);
    });
});

describe('elapsedDays', () => {
    it('is 0 before the start, counts today, and stops at the last day', () => {
        expect(elapsedDays('2026-11-10', '2026-11-19', '2026-11-09')).toBe(0);
        expect(elapsedDays('2026-11-10', '2026-11-19', '2026-11-10')).toBe(1);
        expect(elapsedDays('2026-11-10', '2026-11-19', '2026-11-14')).toBe(5);
        expect(elapsedDays('2026-11-10', '2026-11-19', '2026-12-31')).toBe(10);
    });
});

describe('expectedBy and onTrack', () => {
    it('is the even pace, rounded to a record', () => {
        expect(expectedBy(100, '2026-11-10', '2026-11-19', '2026-11-14')).toBe(50);
        expect(expectedBy(100, '2026-11-10', '2026-11-19', '2026-11-12')).toBe(30);
        expect(expectedBy(10, '2026-11-10', '2026-11-12', '2026-11-10')).toBe(3);
        expect(expectedBy(10, '2026-11-10', '2026-11-12', '2026-11-11')).toBe(7);
    });
    it('is nothing before the start and the whole target after the end', () => {
        expect(expectedBy(100, '2026-11-10', '2026-11-19', '2026-11-01')).toBe(0);
        expect(expectedBy(100, '2026-11-10', '2026-11-19', '2027-01-01')).toBe(100);
    });
    it('is on track at or above the pace', () => {
        expect(onTrack(50, 50)).toBe(true);
        expect(onTrack(49, 50)).toBe(false);
        expect(onTrack(0, 0)).toBe(true);
    });
});

describe('seriesOf', () => {
    it('fills the last 14 days with zeros, oldest first, today last', () => {
        const series = seriesOf(
            new Map([
                ['2026-11-16', 4],
                ['2026-11-03', 2],
                ['2026-11-02', 9]
            ]),
            '2026-11-16'
        );
        expect(series).toHaveLength(14);
        expect(series[0]).toEqual({ day: '2026-11-03', count: 2 });
        expect(series[13]).toEqual({ day: '2026-11-16', count: 4 });
        expect(series.filter((d) => d.count === 0)).toHaveLength(12);
    });
    it('crosses a month and a year', () => {
        const series = seriesOf(new Map(), '2027-01-03', 5);
        expect(series.map((d) => d.day)).toEqual([
            '2026-12-30',
            '2026-12-31',
            '2027-01-01',
            '2027-01-02',
            '2027-01-03'
        ]);
    });
});

describe('totalsOf', () => {
    it('adds every office, and the target and pace of those that have one', () => {
        expect(
            totalsOf([
                { today: 2, total: 10, target: 40, expected: 20 },
                { today: 1, total: 3, target: null, expected: null },
                { today: 0, total: 5, target: 10, expected: 5 }
            ])
        ).toEqual({ today: 3, total: 18, target: 50, expected: 25 });
    });
    it('has no target when none is set', () => {
        expect(totalsOf([{ today: 1, total: 1, target: null, expected: null }])).toMatchObject({
            target: null,
            expected: null
        });
        expect(totalsOf([])).toEqual({ today: 0, total: 0, target: null, expected: null });
    });
});

describe('campaignCreateSchema', () => {
    const good = {
        kind: 'bolo_season',
        name: { am: 'የቦሎ ዘመቻ', en: 'Bolo season' },
        startsOn: '2026-11-01',
        endsOn: '2026-11-30'
    };
    it('takes a campaign of one to 366 days', () => {
        expect(campaignCreateSchema.safeParse(good).success).toBe(true);
        expect(campaignCreateSchema.safeParse({ ...good, endsOn: '2026-11-01' }).success).toBe(true);
        expect(campaignCreateSchema.safeParse({ ...good, endsOn: '2027-11-01' }).success).toBe(true);
    });
    it('refuses one that ends first, lasts too long, or is not a body', () => {
        expect(campaignCreateSchema.safeParse({ ...good, endsOn: '2026-10-31' }).success).toBe(false);
        expect(campaignCreateSchema.safeParse({ ...good, endsOn: '2027-11-02' }).success).toBe(false);
        expect(campaignCreateSchema.safeParse({ ...good, kind: 'other' }).success).toBe(false);
        expect(campaignCreateSchema.safeParse({ ...good, name: { en: 'only' } }).success).toBe(false);
        expect(campaignCreateSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    });
});
