import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime } from './format';

describe('dates on the engine’s screens', () => {
    it('are in the Ethiopian calendar by default, on the Addis Ababa clock', () => {
        const en = { language: 'en', calendar: 'ethiopian' } as const;
        // 7 November 2026 is 28 Tikimt 2019; 21:46 UTC is 00:46 the next day in Addis Ababa
        expect(formatDate('2026-11-07', '', en)).toContain('2019');
        expect(formatDate('2026-11-07', '', en)).toContain('Tikimt');
        expect(formatDateTime('2026-11-06T21:46:00Z', '', en)).toBe('28 Tikimt 2019 E.C. 00:46');
        expect(formatDate(undefined, '—', en)).toBe('—');
        // without a host: Amharic, Ethiopian
        expect(formatDate('2026-11-07')).toContain('2019');
    });

    it('are in the Gregorian calendar for whoever chose it', () => {
        expect(formatDate('2026-11-07', '', { language: 'en', calendar: 'gregorian' })).toContain('2026');
    });
});
