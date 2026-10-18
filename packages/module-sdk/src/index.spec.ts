import { describe, expect, it } from 'vitest';

import { defineModule, manifestProblems } from './index';

const valid = { key: 'competency', layer: 'work-process', version: '1.0.0', dependsOn: ['kernel', 'drivers'] } as const;

describe('defineModule', () => {
    it('returns a valid manifest unchanged', () => {
        expect(defineModule(valid)).toBe(valid);
    });

    it('rejects a key that is not kebab-case', () => {
        expect(() => defineModule({ ...valid, key: 'Competency_1' })).toThrow(/kebab-case/);
    });

    it('rejects a module that depends on itself', () => {
        expect(() => defineModule({ ...valid, dependsOn: ['competency'] })).toThrow(/itself/);
    });

    it('rejects a kernel with dependencies', () => {
        expect(() => defineModule({ ...valid, key: 'kernel', layer: 'kernel', dependsOn: ['forms'] })).toThrow(
            /kernel depends on nothing/
        );
    });

    it('lists every problem at once', () => {
        const problems = manifestProblems({ key: 'X', layer: 'platform', version: 'v1', dependsOn: ['a', 'a'] });
        expect(problems).toHaveLength(3);
    });
});
