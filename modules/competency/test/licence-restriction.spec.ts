/**
 * When a recorded suspension or cancellation holds on a licence (DVC-21, ADR-0064 §6, task 1.6c): the other licence services refuse
 * the licence on those days.
 */
import { describe, expect, it } from 'vitest';

import { restrictionHolds } from '../contracts';

describe('a licence restriction', () => {
    it('holds a suspension from its first to its last day, both included', () => {
        const suspension = { kind: 'suspension', startsOn: '2026-11-10', endsOn: '2026-12-10' } as const;
        expect(restrictionHolds(suspension, '2026-11-09')).toBe(false);
        expect(restrictionHolds(suspension, '2026-11-10')).toBe(true);
        expect(restrictionHolds(suspension, '2026-12-10')).toBe(true);
        expect(restrictionHolds(suspension, '2026-12-11')).toBe(false);
    });

    it('holds a cancellation from its first day on, for good', () => {
        const cancellation = { kind: 'cancellation', startsOn: '2026-11-10', endsOn: null } as const;
        expect(restrictionHolds(cancellation, '2026-11-09')).toBe(false);
        expect(restrictionHolds(cancellation, '2026-11-10')).toBe(true);
        expect(restrictionHolds(cancellation, '2036-01-01')).toBe(true);
    });

    it('never holds a suspension without a last day', () => {
        expect(restrictionHolds({ kind: 'suspension', startsOn: '2026-11-10', endsOn: null }, '2026-11-20')).toBe(
            false
        );
    });
});
