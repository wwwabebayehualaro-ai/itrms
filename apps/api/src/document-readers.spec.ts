/**
 * Who reads issued documents (ADR-0055): the routes ask for `issued-document:read-case`, the narrower of the two, so a role given
 * the office-wide `issued-document:read` without it would read nothing. Every installed role that grants one grants the other.
 */
import { describe, expect, it } from 'vitest';

import { SLICES } from './slices';

const granted = new Map<string, Set<string>>();
for (const slice of SLICES)
    for (const [role, permissions] of Object.entries(slice.manifest.roles ?? {})) {
        const held = granted.get(role) ?? new Set<string>();
        for (const p of permissions) held.add(p);
        granted.set(role, held);
    }

describe('the readers of issued documents', () => {
    it('give every office-wide reader the case reading too', () => {
        const without = [...granted]
            .filter(([, held]) => held.has('issued-document:read') && !held.has('issued-document:read-case'))
            .map(([role]) => role);
        expect(without).toEqual([]);
    });

    it('bind the inspector to the documents of its cases', () => {
        const inspector = granted.get('competency.inspector');
        expect(inspector?.has('issued-document:read-case')).toBe(true);
        expect(inspector?.has('issued-document:read')).toBe(false);
    });
});
