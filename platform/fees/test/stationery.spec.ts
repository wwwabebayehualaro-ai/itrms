/**
 * Controlled stationery's contracts (task 1.12a): the item's machine for every status and event, the serials as typed, and
 * the commands' input rules.
 */
import { describe, expect, it } from 'vitest';

import {
    FINAL_STATIONERY_STATUSES,
    STATIONERY_STATUSES,
    STATIONERY_TRANSITIONS,
    nextStationeryStatus,
    parseStationeryKey,
    selectionSerials,
    stationeryClosingSchema,
    stationeryKey,
    stationeryReceiveSchema,
    stationerySelectionSchema,
    type StationeryEvent,
    type StationeryStatus
} from '../contracts';

const EVENTS = Object.keys(STATIONERY_TRANSITIONS) as Exclude<StationeryEvent, 'receive'>[];

describe('the item machine', () => {
    const expected: Record<string, StationeryStatus | null> = {
        'in_stock/allocate': 'allocated',
        'allocated/accept': 'in_stock',
        'in_stock/recall': 'in_stock',
        'allocated/recall': 'in_stock',
        'in_stock/use': 'used',
        'in_stock/spoil': 'spoiled',
        'in_stock/void': 'void',
        'allocated/void': 'void',
        'in_stock/lose': 'missing',
        'allocated/lose': 'missing'
    };

    it.each(STATIONERY_STATUSES.flatMap((s) => EVENTS.map((e) => [s, e] as const)))(
        'from %s on %s',
        (status, event) => {
            expect(nextStationeryStatus(status, event)).toBe(expected[`${status}/${event}`] ?? null);
        }
    );

    it('has no way out of a final status, and an allocated item cannot be used before it is accepted', () => {
        for (const final of FINAL_STATIONERY_STATUSES)
            for (const event of EVENTS) expect(nextStationeryStatus(final, event)).toBeNull();
        expect(nextStationeryStatus('allocated', 'use')).toBeNull();
        expect(nextStationeryStatus('allocated', 'spoil')).toBeNull();
    });
});

describe('a serial as typed', () => {
    it('splits the series from the number, whatever the spacing and case', () => {
        expect(parseStationeryKey('LB 0001234')).toEqual({ series: 'LB', serial: 1234, key: 'LB0001234' });
        expect(parseStationeryKey('lb-1234')).toEqual({ series: 'LB', serial: 1234, key: 'LB1234' });
        expect(parseStationeryKey('0003539')).toEqual({ series: '', serial: 3539, key: '0003539' });
        expect(parseStationeryKey('G251')?.series).toBe('G');
    });

    it('refuses what is not a serial', () => {
        for (const text of ['', 'ABC', '0', 'TOOLONGSERIES1', '12-34-x', 'A1B2'])
            expect(parseStationeryKey(text)).toBeNull();
    });

    it('prints a key with the width the forms carry', () => {
        expect(stationeryKey('LB', 1234, 7)).toBe('LB0001234');
        expect(stationeryKey('', 254, 7)).toBe('0000254');
    });
});

describe('a selection', () => {
    it('lists a run in order, and a list of keys in series and serial order', () => {
        expect(selectionSerials({ series: 'A', from: 9, to: 11 })).toEqual([
            { series: 'A', serial: 9 },
            { series: 'A', serial: 10 },
            { series: 'A', serial: 11 }
        ]);
        const keys = stationerySelectionSchema.parse({ keys: ['B2', 'A10', 'a9'] });
        expect(selectionSerials(keys)).toEqual([
            { series: 'A', serial: 9 },
            { series: 'A', serial: 10 },
            { series: 'B', serial: 2 }
        ]);
    });

    it('refuses a run that ends before it starts or is too long, and a serial listed twice', () => {
        expect(stationerySelectionSchema.safeParse({ series: 'A', from: 10, to: 9 }).success).toBe(false);
        expect(stationerySelectionSchema.safeParse({ series: 'A', from: 1, to: 10_001 }).success).toBe(false);
        expect(stationerySelectionSchema.safeParse({ keys: ['A 9', 'a9'] }).success).toBe(false);
    });
});

describe('the commands', () => {
    const delivery = {
        kind: 'bolo_sticker',
        reference: 'BUREAU-2018-07',
        receivedOn: '2026-10-01',
        range: { series: '', from: 3501, to: 3600 },
        variant: 'taxi',
        validEfy: 2018
    };

    it('takes a delivery from the bureau by default, with its variant, year and unit price', () => {
        expect(stationeryReceiveSchema.parse({ ...delivery, unitCostSantim: '120076' })).toMatchObject({
            source: 'regional_bureau',
            variant: 'taxi',
            validEfy: 2018,
            unitCostSantim: '120076'
        });
    });

    it('refuses a width narrower than the last serial, a variant that is not a code, and a price in Birr', () => {
        expect(stationeryReceiveSchema.safeParse({ ...delivery, width: 3 }).success).toBe(false);
        expect(stationeryReceiveSchema.safeParse({ ...delivery, variant: 'Taxi cars' }).success).toBe(false);
        expect(stationeryReceiveSchema.safeParse({ ...delivery, unitCostSantim: '1200.76' }).success).toBe(false);
    });

    it('takes a closing with no run counted (nothing on hand)', () => {
        expect(
            stationeryClosingSchema.safeParse({ kind: 'licence_blank', closedOn: '2026-10-01', counted: [] }).success
        ).toBe(true);
    });
});
