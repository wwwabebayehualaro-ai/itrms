/**
 * The licensing rules of Proclamation 1074/2018 (ethiopia-context.md §3.1), as pure functions. Dates are Gregorian calendar days,
 * `YYYY-MM-DD`. The catalogue of grades (Art. 12) is configuration; these say what it means. Isomorphic, so a screen can warn with
 * the same rule the server decides by.
 */

/** A temporary licence's term (Art. 15(2)). */
export const TEMPORARY_YEARS = 2;
/** A permanent licence's term (Art. 19(1)), and for a holder over 55 (Art. 19(4)). */
export const RENEWAL_YEARS = 4;
export const RENEWAL_YEARS_OVER_55 = 2;
export const OVER_AGE = 55;
/** How long before its expiry a licence can be renewed, when a service sets nothing (the proclamation has no figure). */
export const RENEWAL_WINDOW_MONTHS = 6;
/** Later than this after expiry, a renewal needs a practical exam (Art. 19(5)). */
export const LATE_RENEWAL_YEARS = 1;

const parts = (day: string) => {
    const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
    return { year, month, date };
};

const text = (year: number, month: number, date: number) =>
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A day some calendar months later; the 31st of a shorter month, or 29 February in another year, is its month's last day. */
export function addMonths(day: string, months: number): string {
    const { year, month, date } = parts(day);
    const zero = year * 12 + (month - 1) + months;
    const toYear = Math.floor(zero / 12);
    const toMonth = zero - toYear * 12 + 1;
    return text(toYear, toMonth, Math.min(date, lastDayOf(toYear, toMonth)));
}

export const addYears = (day: string, years: number): string => addMonths(day, years * 12);

/** Completed years on a day. */
export function ageOn(birthDate: string, day: string): number {
    const born = parts(birthDate);
    const on = parts(day);
    const years = on.year - born.year;
    return on.month > born.month || (on.month === born.month && on.date >= born.date) ? years : years - 1;
}

/** Today in Ethiopia. */
export const addisDay = (now = new Date()): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(now);

export interface GradeRule {
    key: string;
    /** none: the grade sets no age (Taxi driving, which needs a licence that already did) */
    minAge: number | null;
    /** the school grade completed */
    minEducation: number;
    /** any one of these, held permanently for `prerequisiteMonths` */
    prerequisites: readonly string[];
    prerequisiteMonths: number;
}

export interface HeldGrade {
    key: string;
    /** since when it has been on a permanent licence; none while temporary */
    permanentSince: string | null;
}

export type EligibilityProblem =
    | { code: 'too_young'; minAge: number }
    | { code: 'education'; minEducation: number }
    | { code: 'prerequisite'; grades: readonly string[]; months: number };

/** Why a person may not apply for a grade (Art. 12, Art. 7(2)): empty when they may. */
export function eligibilityProblems(
    rule: GradeRule,
    person: { birthDate: string; educationGrade: number; held: readonly HeldGrade[] },
    today: string
): EligibilityProblem[] {
    const problems: EligibilityProblem[] = [];
    if (rule.minAge !== null && ageOn(person.birthDate, today) < rule.minAge)
        problems.push({ code: 'too_young', minAge: rule.minAge });
    if (person.educationGrade < rule.minEducation)
        problems.push({ code: 'education', minEducation: rule.minEducation });
    if (rule.prerequisites.length > 0) {
        const met = person.held.some(
            (held) =>
                rule.prerequisites.includes(held.key) &&
                held.permanentSince !== null &&
                addMonths(held.permanentSince, rule.prerequisiteMonths) <= today
        );
        if (!met) problems.push({ code: 'prerequisite', grades: rule.prerequisites, months: rule.prerequisiteMonths });
    }
    return problems;
}

/** A medical examination is current for some months (the service's configuration; the proclamation sets no figure). */
export const medicalIsCurrent = (examinedOn: string, months: number, today: string): boolean =>
    examinedOn <= today && addMonths(examinedOn, months) >= today;

/** The term of a first licence, which is temporary. */
export const temporaryValidUntil = (issuedOn: string): string => addYears(issuedOn, TEMPORARY_YEARS);

/** Too early, a renewal would stack terms, and avoid the shorter term a holder turning 55 is due. */
export const renewalIsOpen = (validUntil: string, months: number, today: string): boolean =>
    addMonths(validUntil, -months) <= today;

export interface RenewalTerms {
    /** past its expiry on this day */
    expired: boolean;
    /** past expiry by more than a year: a practical exam is required (Art. 19(5)) */
    lateOverYear: boolean;
    over55: boolean;
    years: number;
    validUntil: string;
}

/**
 * What a renewal gives. An early renewal loses nothing: its term runs from the old expiry. A late one runs from today. "Over 55" counts
 * from the 55th birthday: the safer reading of Art. 19(4), which gives the shorter term.
 */
export function renewalTerms(licence: { validUntil: string }, birthDate: string, today: string): RenewalTerms {
    const over55 = ageOn(birthDate, today) >= OVER_AGE;
    const years = over55 ? RENEWAL_YEARS_OVER_55 : RENEWAL_YEARS;
    const from = licence.validUntil > today ? licence.validUntil : today;
    return {
        expired: licence.validUntil < today,
        lateOverYear: addYears(licence.validUntil, LATE_RENEWAL_YEARS) < today,
        over55,
        years,
        validUntil: addYears(from, years)
    };
}
