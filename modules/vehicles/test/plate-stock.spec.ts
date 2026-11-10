import { describe, expect, it } from 'vitest';

import {
    FINAL_PLATE_STATUSES,
    nextPlateStatus,
    PLATE_STATUSES,
    PLATE_TRANSITIONS,
    plateParts,
    plateSelectionSchema,
    selectionKeys,
    type PlateEvent,
    type PlateStatus
} from '../contracts/plate-stock';

type Event = Exclude<PlateEvent, 'receive'>;
const EVENTS = Object.keys(PLATE_TRANSITIONS) as Event[];

describe('the plate state machine', () => {
    // every (status, event) pair: the allowed ones and their result, everything else refused
    const ALLOWED: Record<string, PlateStatus> = {
        'in_stock:allocate': 'allocated',
        'allocated:accept': 'in_stock',
        'in_stock:recall': 'in_stock',
        'allocated:recall': 'in_stock',
        'in_stock:reserve': 'reserved',
        'reserved:release': 'in_stock',
        'in_stock:assign': 'assigned',
        'reserved:assign': 'assigned',
        'assigned:retire': 'retired',
        'assigned:lose': 'lost',
        'in_stock:void': 'void',
        'allocated:void': 'void',
        'in_stock:write_off_lost': 'lost',
        'allocated:write_off_lost': 'lost'
    };
    const pairs = PLATE_STATUSES.flatMap((from) => EVENTS.map((event) => [from, event] as const));

    it.each(pairs)('%s + %s', (from, event) => {
        expect(nextPlateStatus(from, event)).toBe(ALLOWED[`${from}:${event}`] ?? null);
    });

    it('never moves a plate out of a final status, and assigns a plate once in its life', () => {
        for (const status of FINAL_PLATE_STATUSES)
            for (const event of EVENTS) expect(nextPlateStatus(status, event), `${status} ${event}`).toBeNull();
        expect(nextPlateStatus('assigned', 'assign')).toBeNull();
        expect(nextPlateStatus('retired', 'assign')).toBeNull();
    });
});

describe('a selection of plates', () => {
    it('reads a run of one series, inclusive, in order', () => {
        const run = plateSelectionSchema.parse({ series: 'qsa', from: 1, to: 3 });
        expect(selectionKeys(run)).toEqual(['ETHQSA0001', 'ETHQSA0002', 'ETHQSA0003']);
        expect(selectionKeys(plateSelectionSchema.parse({ series: 'ABC', from: 0, to: 0 }))).toEqual(['ETHABC0000']);
    });

    it('refuses a run that goes backwards, is longer than 10 000, or has a bad series', () => {
        for (const bad of [
            { series: 'ABC', from: 5, to: 4 },
            { series: 'AB', from: 1, to: 2 },
            { series: 'AB1', from: 1, to: 2 },
            { series: 'ABC', from: 0, to: 10000 },
            { series: 'ABC', from: -1, to: 2 }
        ])
            expect(plateSelectionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });

    it('reads a list of national plates in Latin or Ethiopic letters, and refuses others and repeats', () => {
        const list = plateSelectionSchema.parse({ keys: ['eth abc 1234', 'ኢት ABC 1235'] });
        expect(selectionKeys(list)).toEqual(['ETHABC1234', 'ETHABC1235']);
        expect(plateSelectionSchema.safeParse({ keys: ['OR 3-A12345'] }).success).toBe(false);
        expect(plateSelectionSchema.safeParse({ keys: ['CD 123'] }).success).toBe(false);
        expect(plateSelectionSchema.safeParse({ keys: ['ETH ABC 1234', 'ETHABC1234'] }).success).toBe(false);
        expect(plateSelectionSchema.safeParse({ keys: [] }).success).toBe(false);
    });

    it('splits a key into its series and serial', () => {
        expect(plateParts('ETHQSA0042')).toEqual({ series: 'QSA', serial: 42 });
    });
});
