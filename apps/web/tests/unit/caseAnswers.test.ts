import { describe, expect, it } from 'vitest';

import { amendable, lookupIds } from '@/lib/caseAnswers';
import type { CaseOut } from '@/lib/workflow';

const step = (fields: unknown[], answers: Record<string, unknown>) =>
    ({ form: { fields }, answers }) as unknown as CaseOut['steps'][number];
const lookup = (id: string, provider: string) => ({ id, type: 'RegistryLookup', props: { provider } });

describe('lookupIds', () => {
    it("collects each registry's ids from the steps' lookup answers, a repeating section's rows too", () => {
        const steps = [
            step([lookup('owner', 'person'), { id: 'plate', type: 'InputText' }], {
                owner: 'p-1',
                plate: 'ETH ABC 0001'
            }),
            step([{ id: 'vehicles', type: 'FormArray' }, lookup('vehicle', 'vehicle'), lookup('driver', 'person')], {
                vehicles: [
                    { vehicle: 'v-1', driver: 'p-2' },
                    { vehicle: '', driver: 'p-3' }
                ]
            })
        ];
        expect(Object.fromEntries(lookupIds(steps))).toEqual({ person: ['p-1', 'p-2', 'p-3'], vehicle: ['v-1'] });
    });

    it('asks for nothing when no step has a lookup, or its answer is not an id', () => {
        expect(lookupIds([step([{ id: 'plate', type: 'InputText' }], { plate: 'x' })]).size).toBe(0);
        expect(lookupIds([step([lookup('owner', 'person')], { owner: 7 })]).size).toBe(0);
        expect(lookupIds([step([lookup('owner', 'person')], {})]).size).toBe(0);
    });
});

describe('amendable', () => {
    it('leaves out the masked fields and what they hold, wherever they are stored', () => {
        const document = {
            schemaVersion: 2,
            fields: [
                { id: 'relation', parentId: 'family' },
                { id: 'plate' },
                { id: 'phone' },
                { id: 'family' },
                { id: 'note', parentId: 'box' },
                { id: 'box' }
            ]
        };
        expect(amendable(document, ['phone', 'family'])).toEqual({
            schemaVersion: 2,
            fields: [{ id: 'plate' }, { id: 'note', parentId: 'box' }, { id: 'box' }]
        });
        expect(amendable(document, [])).toBe(document);
    });
});
