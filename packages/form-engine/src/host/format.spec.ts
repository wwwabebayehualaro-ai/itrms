import { afterEach, describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, setDateDisplay } from './format';

describe('dates on the engine’s screens', () => {
    afterEach(() => setDateDisplay({ language: 'am', calendar: 'ethiopian' }));

    it('are in the Ethiopian calendar by default, on the Addis Ababa clock', () => {
        setDateDisplay({ language: 'en', calendar: 'ethiopian' });
        // 7 November 2026 is 28 Tikimt 2019; 21:46 UTC is 00:46 the next day in Addis Ababa
        expect(formatDate('2026-11-07')).toContain('2019');
        expect(formatDate('2026-11-07')).toContain('Tikimt');
        expect(formatDateTime('2026-11-06T21:46:00Z')).toBe('28 Tikimt 2019 E.C. 00:46');
        expect(formatDate(undefined, '—')).toBe('—');
    });

    it('are in the Gregorian calendar for whoever chose it', () => {
        setDateDisplay({ language: 'en', calendar: 'gregorian' });
        expect(formatDate('2026-11-07')).toContain('2026');
    });
});
