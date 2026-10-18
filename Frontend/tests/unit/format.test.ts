import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate } from '@platform/lib/format';

describe('format', () => {
    it('formats byte sizes', () => {
        expect(formatBytes(0)).toBeTruthy();
        expect(formatBytes(1536)).toMatch(/1\.5\s?KB/i);
    });

    it('shows the placeholder for a missing date', () => {
        expect(formatDate(null)).toBe('No date');
        expect(formatDate(undefined, '-')).toBe('-');
    });
});
