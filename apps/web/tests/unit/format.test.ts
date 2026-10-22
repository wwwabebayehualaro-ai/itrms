import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, formatDay, formatMoney, formatNumberIn } from '@/lib/format';

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

describe('locale-aware formats (task 0.13)', () => {
    it('writes money from santim without floats, in Birr per language', () => {
        expect(formatMoney(123450n, 'am')).toBe('1,234.50 ብር');
        expect(formatMoney('123450', 'en')).toBe('Birr 1,234.50');
        expect(formatMoney(5n, 'en')).toBe('Birr 0.05');
        expect(formatMoney(-100n, 'am')).toBe('-1.00 ብር');
        // beyond Number's exact range: still exact
        expect(formatMoney(900719925474099312n, 'en')).toBe('Birr 9,007,199,254,740,993.12');
        // not santim: a float or a number in words is never shown as an amount
        expect(formatMoney('12.5', 'en')).toBe('—');
        expect(formatMoney('1e3', 'en')).toBe('—');
        expect(formatNumberIn(1234567n)).toBe('1,234,567');
    });

    it('shows dates Ethiopian by default, Gregorian on request, an instant as its Addis Ababa date', () => {
        expect(formatDay('2026-10-22')).toBe('ጥቅምት 12 ቀን 2019 ዓ.ም');
        expect(formatDay('2026-10-22', { language: 'en' })).toBe('12 Tikimt 2019 E.C.');
        expect(formatDay('2026-10-22', { language: 'en', calendar: 'gregorian' })).toBe('22 October 2026');
        expect(formatDay('2026-13-45')).toBe('—');
        expect(formatDay('2026-02-29')).toBe('—');
        // 21:30 UTC on 21 October is already 22 October in Addis Ababa
        expect(formatDay(new Date('2026-10-21T21:30:00Z'), { language: 'en' })).toBe('12 Tikimt 2019 E.C.');
        expect(formatDay(null)).toBe('—');
    });
});
