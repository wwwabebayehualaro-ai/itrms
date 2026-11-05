/** The catalogue of licence grades, from Art. 12 of Proclamation 1074/2018 (ethiopia-context.md §3.1). */
import type { I18nText } from '@itrms/schemas';

import type { GRADE_FAMILIES } from '../contracts';

export interface GradeSeed {
    key: string;
    name: I18nText;
    family: (typeof GRADE_FAMILIES)[number];
    minAge: number | null;
    minEducation: number;
    prerequisites: string[];
    prerequisiteMonths: number;
}

export const LICENCE_GRADES: readonly GradeSeed[] = [
    {
        key: 'motorcycle',
        name: { am: 'ሞተር ሳይክል', en: 'Motorcycle' },
        family: 'motorcycle',
        minAge: 18,
        minEducation: 4,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'automobile',
        name: { am: 'አውቶሞቢል', en: 'Automobile' },
        family: 'automobile',
        minAge: 18,
        minEducation: 4,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'three-wheel',
        name: { am: 'ባለ ሶስት እግር ሞተር ሳይክል', en: 'Three-wheel motorcycle' },
        family: 'motorcycle',
        minAge: 20,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'truck-1',
        name: { am: 'ደረቅ ጭነት 1', en: 'Truck I' },
        family: 'truck',
        minAge: 22,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'public-1',
        name: { am: 'ህዝብ ማመላለሻ 1', en: 'Public transport I' },
        family: 'public',
        minAge: 22,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'truck-2',
        name: { am: 'ደረቅ ጭነት 2', en: 'Truck II' },
        family: 'truck',
        minAge: 24,
        minEducation: 10,
        prerequisites: ['truck-1'],
        prerequisiteMonths: 12
    },
    {
        key: 'public-2',
        name: { am: 'ህዝብ ማመላለሻ 2', en: 'Public transport II' },
        family: 'public',
        minAge: 24,
        minEducation: 10,
        prerequisites: ['public-1'],
        prerequisiteMonths: 12
    },
    {
        key: 'tanker-1',
        name: { am: 'ፈሳሽ ጭነት 1', en: 'Tanker I' },
        family: 'tanker',
        minAge: 24,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'truck-3',
        name: { am: 'ደረቅ ጭነት 3', en: 'Truck III' },
        family: 'truck',
        minAge: 26,
        minEducation: 10,
        prerequisites: ['truck-2'],
        prerequisiteMonths: 12
    },
    {
        key: 'public-3',
        name: { am: 'ህዝብ ማመላለሻ 3', en: 'Public transport III' },
        family: 'public',
        minAge: 26,
        minEducation: 10,
        prerequisites: ['public-2'],
        prerequisiteMonths: 12
    },
    {
        key: 'tanker-2',
        name: { am: 'ፈሳሽ ጭነት 2', en: 'Tanker II' },
        family: 'tanker',
        minAge: 26,
        minEducation: 10,
        prerequisites: ['tanker-1'],
        prerequisiteMonths: 12
    },
    {
        key: 'machinery',
        name: { am: 'ማሽነሪ ኦፕሬተር', en: 'Machinery operator' },
        family: 'machinery',
        minAge: 20,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'taxi',
        name: { am: 'ታክሲ', en: 'Taxi driving' },
        family: 'taxi',
        minAge: null,
        minEducation: 10,
        prerequisites: ['automobile', 'public-1', 'public-2', 'public-3'],
        prerequisiteMonths: 0
    }
];
