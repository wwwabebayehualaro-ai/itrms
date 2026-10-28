/**
 * A resumed draft's answers (task 0.20c): this browser's change goes over the server's, and the server's answers the
 * browser does not keep (Sensitive, unclassified) stay, in a repeating section's rows too; rows added or taken out here
 * stand as they are, so no answer lands on another row.
 */
import { describe, expect, it } from 'vitest';

import { mergeAnswers } from '@/lib/drafts/merge';

describe('mergeAnswers', () => {
    it("keeps the server's answers the browser lacks, at the top and row by row", () => {
        const server = {
            name: 'Abebe',
            fin: '1234',
            children: [
                { childName: 'Almaz', childFin: '2222' },
                { childName: 'Kebede', childFin: '3333' }
            ]
        };
        const local = {
            name: 'Abebe K.',
            children: [{ childName: 'Almaz T.' }, { childName: 'Kebede' }],
            town: 'Boditi'
        };
        expect(mergeAnswers(server, local)).toEqual({
            name: 'Abebe K.',
            fin: '1234',
            town: 'Boditi',
            children: [
                { childName: 'Almaz T.', childFin: '2222' },
                { childName: 'Kebede', childFin: '3333' }
            ]
        });
    });

    it("takes this browser's rows as they are when rows were added or taken out here", () => {
        const server = {
            children: [
                { childName: 'Almaz', childFin: '2222' },
                { childName: 'Kebede', childFin: '3333' }
            ]
        };
        const local = { children: [{ childName: 'Kebede' }] };
        expect(mergeAnswers(server, local)).toEqual({ children: [{ childName: 'Kebede' }] });
    });
});
