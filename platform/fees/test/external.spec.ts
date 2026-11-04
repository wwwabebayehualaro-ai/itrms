/**
 * Money paid elsewhere, what needs no database (task 0.22c, ADR-0043): how a reference compares, how a statement reads, and
 * when a line may verify a reference.
 */
import { describe, expect, it } from 'vitest';

import { externalRefDecisionSchema, externalRefInputSchema, FEES_SETTINGS, MAX_STATEMENT_LINES } from '../contracts';
import { addisDayOf, externalReferenceKey, fiscalYearOfDay } from '../api/external-refs';
import { headerProblem, parseStatement, santimOfBirr } from '../api/statement-layouts';
import { judgeLine } from '../api/statement-match';

const parse = (content: string) => parseStatement('placeholder-v1', content);

describe('a reference paid elsewhere', () => {
    it('compares by its letters and digits, without leading zeros', () => {
        expect(externalReferenceKey('ft 26-0001')).toBe('FT260001');
        expect(externalReferenceKey('FT/26.0001')).toBe('FT260001');
        // a spreadsheet drops a serial's zeros on the way to a statement
        expect(externalReferenceKey('000123')).toBe('123');
        expect(externalReferenceKey('123')).toBe('123');
        expect(externalReferenceKey('0000')).toBe('0');
        // nothing to compare is nothing
        expect(externalReferenceKey('---')).toBe('');
    });

    it('belongs to the fiscal year of the day it was paid (Hamle 1 starts one)', () => {
        // Sene 30, 2018 E.C. is 7 July 2026; Hamle 1, 2018 is 8 July 2026: EFY 2019
        expect(fiscalYearOfDay('2026-07-07')).toBe(2018);
        expect(fiscalYearOfDay('2026-07-08')).toBe(2019);
    });

    it('is a whole amount in santim digits, and a rejection says why', () => {
        const input = {
            issuer: 'CBE',
            reference: 'FT1',
            amountSantim: '40000',
            paidOn: '2026-11-01',
            receivedFrom: 'Generated Applicant'
        };
        expect(externalRefInputSchema.safeParse(input).success).toBe(true);
        expect(externalRefInputSchema.safeParse({ ...input, amountSantim: '400.00' }).success).toBe(false);
        expect(externalRefInputSchema.safeParse({ ...input, issuer: 'cbe' }).success).toBe(false);
        expect(externalRefDecisionSchema.safeParse({ decision: 'verified' }).success).toBe(true);
        expect(externalRefDecisionSchema.safeParse({ decision: 'rejected' }).success).toBe(false);
        expect(externalRefDecisionSchema.safeParse({ decision: 'rejected', note: 'no such receipt' }).success).toBe(
            true
        );
    });

    it("takes the region's issuers and verifiers from settings of their own shape", () => {
        const name = { am: 'ገቢዎች', en: 'Revenue' };
        const issuers = FEES_SETTINGS['fees.external.issuers'];
        expect(issuers.safeParse([{ code: 'REVENUE', kind: 'revenue_office', name }]).success).toBe(true);
        expect(issuers.safeParse([{ code: 'REVENUE', kind: 'somewhere', name }]).success).toBe(false);
        expect(issuers.safeParse([]).success).toBe(false);
        expect(FEES_SETTINGS['fees.external.verifierRoles'].safeParse(['finance_officer']).success).toBe(true);
    });
});

describe('an amount on a statement', () => {
    it('is read as santim by its digits, never through a number', () => {
        expect(santimOfBirr('1,250.50')).toBe(125050n);
        expect(santimOfBirr('1250.5')).toBe(125050n);
        expect(santimOfBirr('400')).toBe(40000n);
        expect(santimOfBirr(' 0.07 ')).toBe(7n);
        // large enough that a float would lose it
        expect(santimOfBirr('90071992547409.93')).toBe(9007199254740993n);
    });

    it("refuses what isn't a credit in Birr", () => {
        for (const text of ['', '0', '0.00', '-400', '12,50', '1,2,3', '400.123', 'ETB 400', '1e3'])
            expect(santimOfBirr(text), text).toBeNull();
    });
});

describe('a statement in the placeholder layout', () => {
    it('reads its columns by name, in any case and order, and keeps nothing else', () => {
        const parsed = parse('Date,PAYER,reference,Amount\n2026-11-01,Someone,FT 1,"1,250.50"\n');
        expect(parsed).toEqual({
            ok: true,
            lines: [{ lineNo: 1, reference: 'FT 1', amountSantim: 125050n, paidOn: '2026-11-01', invalid: null }]
        });
    });

    it('takes a byte order mark and Windows line ends, as a spreadsheet saves them', () => {
        const parsed = parse('﻿reference,amount,date\r\nFT1,400,2026-11-01\r\n\r\n');
        expect(parsed.ok && parsed.lines.map((l) => l.reference)).toEqual(['FT1']);
        expect(headerProblem('﻿reference,amount,date\r\nFT1,400,2026-11-01')).toBeNull();
    });

    it('keeps a bad line, marked, and reads the rest', () => {
        const parsed = parse(
            [
                'reference,amount,date',
                ',400,2026-11-01',
                'A1,four hundred,2026-11-01',
                'A2,400,01/11/2026',
                'A3,400,2026-02-30',
                'A4,400,2999-01-01',
                'A5,400,2026-11-01'
            ].join('\n')
        );
        expect(parsed.ok && parsed.lines.map((l) => l.invalid)).toEqual([
            'reference',
            'amount',
            'date',
            'date',
            'future_date',
            null
        ]);
    });

    it('stores a formula as the text it is', () => {
        const parsed = parse('reference,amount,date\n"=HYPERLINK(""http://x"")",400,2026-11-01\n');
        expect(parsed.ok && parsed.lines[0]?.reference).toBe('=HYPERLINK("http://x")');
    });

    it('fails as a whole only when it is not the layout', () => {
        expect(parse('ref,amt,when\nA,1,2026-11-01')).toEqual({ ok: false, failure: 'header' });
        expect(parse('reference,amount,date\n"unclosed,400,2026-11-01')).toEqual({ ok: false, failure: 'format' });
        expect(headerProblem('ref,amt,when')).toBe('header');
        const many = `reference,amount,date\n${'A,1,2026-11-01\n'.repeat(MAX_STATEMENT_LINES + 1)}`;
        expect(parse(many)).toEqual({ ok: false, failure: 'too_many_lines' });
    });
});

describe('a line against a reference', () => {
    const facts = {
        line: { amountSantim: 40000n, paidOn: '2026-11-02' },
        ref: { amountSantim: 40000n, paidOn: '2026-11-02', enteredBy: 'counter' },
        orderDay: '2026-11-01',
        importedBy: 'finance'
    };

    it('verifies it on an exact match', () => {
        expect(judgeLine(facts)).toEqual({ state: 'matched' });
        // paid the day the order was issued
        expect(judgeLine({ ...facts, orderDay: '2026-11-02' })).toEqual({ state: 'matched' });
    });

    it('leaves anything else to a person, with the reason', () => {
        expect(judgeLine({ ...facts, line: { ...facts.line, amountSantim: 39999n } })).toEqual({
            state: 'amount_mismatch'
        });
        expect(judgeLine({ ...facts, line: { ...facts.line, paidOn: '2026-11-03' } })).toEqual({
            state: 'held',
            reason: 'date_differs'
        });
        expect(judgeLine({ ...facts, orderDay: '2026-11-03' })).toEqual({ state: 'held', reason: 'paid_before_order' });
    });

    it('never verifies what its importer entered', () => {
        expect(judgeLine({ ...facts, importedBy: 'counter' })).toEqual({ state: 'held', reason: 'importer_entered' });
    });
});

describe('the day an order was issued', () => {
    it('is the day in Addis Ababa, not in UTC', () => {
        expect(addisDayOf(new Date('2026-11-01T21:30:00Z'))).toBe('2026-11-02');
        expect(addisDayOf(new Date('2026-11-01T20:30:00Z'))).toBe('2026-11-01');
    });
});
