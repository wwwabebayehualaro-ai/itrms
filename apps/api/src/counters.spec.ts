/**
 * The counters on enable (task 1.4b4, ADR-0056): the manifests declare each counter with the pattern the seeds and the
 * services number with, and the services that need them. A pattern copied into a manifest that drifted from the contract's
 * would give an office set up later other numbers than one seeded.
 */
import {
    LICENCE_COUNTER,
    LICENCE_PATTERN,
    TEMPORARY_BOLO_COUNTER,
    TEMPORARY_BOLO_PATTERN,
    TRANSFER_LETTER_COUNTER,
    TRANSFER_LETTER_PATTERN,
    VEHICLE_TRANSFER_DOCUMENT_COUNTER,
    VEHICLE_TRANSFER_DOCUMENT_PATTERN
} from '@itrms/competency/contracts';
import { RECEIPT_COUNTER, RECEIPT_PATTERN, REMITTANCE_COUNTER, REMITTANCE_PATTERN } from '@itrms/fees/contracts';
import { counterNeeds } from '@itrms/kernel/numbering';
import { REGISTRATION_CERTIFICATE_COUNTER, REGISTRATION_CERTIFICATE_PATTERN } from '@itrms/vehicles/contracts';
import { describe, expect, it } from 'vitest';

import { SLICES } from './slices';

const manifests = SLICES.map((s) => s.manifest);

describe('the counters an office needs', () => {
    it('are declared with the patterns the services number with', () => {
        const declared = new Map(
            manifests.flatMap((m) => m.numberSequences.map((s) => [`${m.key}.${s.key}`, s.pattern] as const))
        );
        expect(Object.fromEntries(declared)).toMatchObject({
            [LICENCE_COUNTER]: LICENCE_PATTERN,
            [TEMPORARY_BOLO_COUNTER]: TEMPORARY_BOLO_PATTERN,
            [TRANSFER_LETTER_COUNTER]: TRANSFER_LETTER_PATTERN,
            [VEHICLE_TRANSFER_DOCUMENT_COUNTER]: VEHICLE_TRANSFER_DOCUMENT_PATTERN,
            [RECEIPT_COUNTER]: RECEIPT_PATTERN,
            [REMITTANCE_COUNTER]: REMITTANCE_PATTERN,
            [REGISTRATION_CERTIFICATE_COUNTER]: REGISTRATION_CERTIFICATE_PATTERN
        });
    });

    it('follow from the services and the capabilities', () => {
        const needs = counterNeeds(manifests);
        expect(needs.of(['DVC-13'], []).map((n) => n.key)).toEqual([
            TRANSFER_LETTER_COUNTER,
            REGISTRATION_CERTIFICATE_COUNTER
        ]);
        expect(needs.of(['DVC-06'], []).map((n) => n.key)).toEqual([REGISTRATION_CERTIFICATE_COUNTER]);
        expect(needs.of(['DVC-01', 'DVC-13'], ['collects_cash']).map((n) => n.key)).toEqual([
            TRANSFER_LETTER_COUNTER,
            RECEIPT_COUNTER,
            REMITTANCE_COUNTER,
            REGISTRATION_CERTIFICATE_COUNTER
        ]);
        // the transfer of a vehicle out of the region numbers its document (task 1.4c2)
        expect(needs.of(['DVC-14'], []).map((n) => n.key)).toEqual([VEHICLE_TRANSFER_DOCUMENT_COUNTER]);
        expect(needs.of(['RS-01', 'LG-01'], ['prints_documents'])).toEqual([]);
    });
});
