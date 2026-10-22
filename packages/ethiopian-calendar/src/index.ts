/**
 * @itrms/ethiopian-calendar (task 0.12): Gregorian ↔ Ethiopian conversion, names in the installation's languages,
 * formatting with optional Ethiopic numerals, the fiscal year, the Ethiopian clock and Addis Ababa business dates. Pure
 * TypeScript with no runtime dependency, so the API, the web app and the document renderer share it.
 */
export {
    addEthiopianDays,
    daysInEthiopianMonth,
    ethiopianDaysBetween,
    ethiopianToJdn,
    gregorianToJdn,
    isEthiopianLeapYear,
    isGregorianLeapYear,
    isValidEthiopianDate,
    isValidGregorianDate,
    jdnToEthiopian,
    jdnToGregorian,
    toEthiopian,
    toGregorian,
    weekday,
    type CalendarDate,
    type EthiopianDate,
    type GregorianDate
} from './convert';
export { CALENDAR_LANGUAGES, ERA, MONTH_NAMES, PROVISIONAL, WEEKDAY_NAMES, type CalendarLanguage } from './names';
export { toEthiopicNumeral } from './numerals';
export { formatEthiopian, formatEthiopianLong, LONG_PATTERN, SHORT_PATTERN, type FormatOptions } from './format';
export { fiscalQuarterOf, fiscalYearOf, fiscalYearRange } from './fiscal';
export { formatEthiopianTime, PERIOD_NAMES, toEthiopianTime, type DayPeriod, type EthiopianTime } from './clock';
export {
    ADDIS_ABABA_OFFSET_MINUTES,
    addisDate,
    addisEthiopianDate,
    efy,
    ethiopianDateAfter,
    ethiopianDayStart,
    ethiopianToday,
    fiscalQuarter,
    startOfAddisDay
} from './business';
