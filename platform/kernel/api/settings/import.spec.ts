import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { regionSettingProblems } from './import';
import type { SettingEntry, SettingsRegistry } from './registry';

const entry = (
    key: string,
    schema: z.ZodType,
    overridableAt: SettingEntry['declaration']['overridableAt']
): [string, SettingEntry] => [
    key,
    {
        declaration: { key, default: null, overridableAt, userPreference: false, sensitive: false },
        owner: 'kernel',
        schema,
        label: `kernel.setting.${key}`
    }
];

const registry: SettingsRegistry = new Map<string, SettingEntry>([
    entry('ui.theme', z.enum(['light', 'dark']), ['region']),
    entry('ops.only', z.string(), ['installation'])
]);

describe('a region’s settings from a file', () => {
    it('takes values its registry allows', () => {
        expect(regionSettingProblems({ 'ui.theme': 'dark' }, registry)).toEqual([]);
    });

    it('names a setting that does not exist, one a region may not set, and a value it refuses', () => {
        const problems = regionSettingProblems({ 'ui.typo': 'x', 'ops.only': 'x', 'ui.theme': 'pink' }, registry);
        expect(problems).toHaveLength(3);
        expect(problems[0]).toContain('ui.typo: no such setting');
        expect(problems[1]).toContain('ops.only: a region cannot set it');
        expect(problems[2]).toContain('ui.theme:');
    });
});
