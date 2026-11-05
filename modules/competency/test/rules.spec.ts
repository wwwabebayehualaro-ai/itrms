/** The licensing rules of Proclamation 1074/2018 (ethiopia-context.md §3.1). */
import { describe, expect, it } from 'vitest';

import {
    addMonths,
    addYears,
    addisDay,
    ageOn,
    eligibilityProblems,
    medicalIsCurrent,
    renewalTerms,
    temporaryValidUntil,
    type GradeRule
} from '../contracts/rules';
import { LICENCE_GRADES } from '../seed';

const rule = (key: string): GradeRule => {
    const grade = LICENCE_GRADES.find((g) => g.key === key);
    if (!grade) throw new Error(key);
    return grade;
};
const TODAY = '2026-11-05';
const person = (
    birthDate: string,
    educationGrade = 12,
    held: { key: string; permanentSince: string | null }[] = []
) => ({
    birthDate,
    educationGrade,
    held
});

describe('days', () => {
    it('adds months and years by the calendar, and keeps to the month’s last day', () => {
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
        expect(addMonths('2026-11-05', 2)).toBe('2027-01-05');
        expect(addYears('2024-02-29', 2)).toBe('2026-02-28');
        expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
        expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    });

    it('counts completed years', () => {
        expect(ageOn('2008-11-05', TODAY)).toBe(18);
        expect(ageOn('2008-11-06', TODAY)).toBe(17);
        expect(ageOn('2008-12-01', TODAY)).toBe(17);
    });

    it('takes today from Ethiopia, three hours ahead of UTC', () => {
        expect(addisDay(new Date('2026-11-05T20:59:00Z'))).toBe('2026-11-05');
        expect(addisDay(new Date('2026-11-05T21:00:00Z'))).toBe('2026-11-06');
    });
});

describe('who may apply (Art. 12)', () => {
    it('lets an 18-year-old with grade 4 apply for an automobile licence, not a day sooner', () => {
        expect(eligibilityProblems(rule('automobile'), person('2008-11-05', 4), TODAY)).toEqual([]);
        expect(eligibilityProblems(rule('automobile'), person('2008-11-06', 4), TODAY)).toEqual([
            { code: 'too_young', minAge: 18 }
        ]);
    });

    it('refuses a 19-year-old asking for Truck I, for age and education both', () => {
        expect(eligibilityProblems(rule('truck-1'), person('2007-06-01', 8), TODAY)).toEqual([
            { code: 'too_young', minAge: 22 },
            { code: 'education', minEducation: 10 }
        ]);
    });

    it('asks Truck II for a year on a permanent Truck I licence', () => {
        const grade = rule('truck-2');
        const old = '1990-01-01';
        const problem = { code: 'prerequisite', grades: ['truck-1'], months: 12 };
        expect(eligibilityProblems(grade, person(old), TODAY)).toEqual([problem]);
        // temporary counts for nothing
        expect(eligibilityProblems(grade, person(old, 12, [{ key: 'truck-1', permanentSince: null }]), TODAY)).toEqual([
            problem
        ]);
        expect(
            eligibilityProblems(grade, person(old, 12, [{ key: 'truck-1', permanentSince: '2025-11-06' }]), TODAY)
        ).toEqual([problem]);
        expect(
            eligibilityProblems(grade, person(old, 12, [{ key: 'truck-1', permanentSince: '2025-11-05' }]), TODAY)
        ).toEqual([]);
        expect(
            eligibilityProblems(grade, person(old, 12, [{ key: 'public-1', permanentSince: '2020-01-01' }]), TODAY)
        ).toEqual([problem]);
    });

    it('needs no prerequisite for Tanker I', () => {
        expect(eligibilityProblems(rule('tanker-1'), person('1990-01-01'), TODAY)).toEqual([]);
    });

    it('asks taxi driving for no age, but a permanent automobile or public transport licence', () => {
        const grade = rule('taxi');
        expect(grade.minAge).toBeNull();
        expect(eligibilityProblems(grade, person('2008-01-01'), TODAY)).toHaveLength(1);
        expect(
            eligibilityProblems(grade, person('2008-01-01', 12, [{ key: 'public-2', permanentSince: TODAY }]), TODAY)
        ).toEqual([]);
    });

    it('has every prerequisite in the catalogue', () => {
        const keys = new Set(LICENCE_GRADES.map((g) => g.key));
        for (const grade of LICENCE_GRADES)
            for (const key of grade.prerequisites) expect(keys.has(key), key).toBe(true);
        expect(LICENCE_GRADES).toHaveLength(13);
    });
});

describe('a medical examination', () => {
    it('is current for its months, and not from the future', () => {
        expect(medicalIsCurrent('2026-05-05', 6, TODAY)).toBe(true);
        expect(medicalIsCurrent('2026-05-04', 6, TODAY)).toBe(false);
        expect(medicalIsCurrent('2026-11-06', 6, TODAY)).toBe(false);
    });
});

describe('a licence’s term', () => {
    it('is two years when temporary (Art. 15(2))', () => {
        expect(temporaryValidUntil(TODAY)).toBe('2028-11-05');
    });

    it('renews for four years from today when expired, and is not late within a year (Art. 19)', () => {
        expect(renewalTerms({ validUntil: '2026-01-01' }, '1990-01-01', TODAY)).toEqual({
            expired: true,
            lateOverYear: false,
            over55: false,
            years: 4,
            validUntil: '2030-11-05'
        });
    });

    it('loses nothing renewed early: the term runs from the old expiry', () => {
        expect(renewalTerms({ validUntil: '2027-01-01' }, '1990-01-01', TODAY)).toMatchObject({
            expired: false,
            validUntil: '2031-01-01'
        });
    });

    it('needs a practical exam over a year late, not on the year’s last day (Art. 19(5))', () => {
        expect(renewalTerms({ validUntil: '2025-11-05' }, '1990-01-01', TODAY).lateOverYear).toBe(false);
        expect(renewalTerms({ validUntil: '2025-11-04' }, '1990-01-01', TODAY).lateOverYear).toBe(true);
    });

    it('renews for two years from the 55th birthday (Art. 19(4))', () => {
        expect(renewalTerms({ validUntil: '2026-01-01' }, '1971-11-05', TODAY)).toMatchObject({
            over55: true,
            years: 2,
            validUntil: '2028-11-05'
        });
        expect(renewalTerms({ validUntil: '2026-01-01' }, '1971-11-06', TODAY)).toMatchObject({
            over55: false,
            years: 4
        });
    });
});
