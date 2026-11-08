import { describe, expect, it } from 'vitest';

import { isSeedCommand, parseSeedCommands } from './seed-commands';

describe('the seed CLI commands', () => {
    it('splits a run into its commands, in order', () => {
        expect(
            parseSeedCommands(['org', 'a.yaml', '--then', 'counters', '--region', 'SER', '--then', 'identity'])
        ).toEqual([['org', 'a.yaml'], ['counters', '--region', 'SER'], ['identity']]);
        expect(parseSeedCommands(['users', 'b.yaml'])).toEqual([['users', 'b.yaml']]);
    });

    it('knows each command and the file it needs', () => {
        expect(isSeedCommand(['identity'])).toBe(true);
        expect(isSeedCommand(['documents', '--region', 'SER'])).toBe(true);
        expect(isSeedCommand(['org', 'a.yaml'])).toBe(true);
        expect(isSeedCommand(['org'])).toBe(false);
        expect(isSeedCommand(['drop', 'x'])).toBe(false);
        // an empty command: a run that ends with --then, or two in a row
        expect(parseSeedCommands(['identity', '--then']).every(isSeedCommand)).toBe(false);
        expect(parseSeedCommands([]).every(isSeedCommand)).toBe(false);
    });
});
