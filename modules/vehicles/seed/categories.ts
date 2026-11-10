/** The catalogue of kinds of vehicle: what the register needs to know about each (seats for a passenger vehicle, load for a freight one). */
import type { I18nText } from '@itrms/schemas';

import type { CATEGORY_FAMILIES } from '../contracts';

export interface CategorySeed {
    key: string;
    name: I18nText;
    family: (typeof CATEGORY_FAMILIES)[number];
    needsSeats: boolean;
    needsLoad: boolean;
}

export const VEHICLE_CATEGORIES: readonly CategorySeed[] = [
    {
        key: 'motorcycle',
        name: { am: 'ሞተር ሳይክል', en: 'Motorcycle' },
        family: 'passenger',
        needsSeats: false,
        needsLoad: false
    },
    {
        key: 'three_wheeler',
        name: { am: 'ባለ ሶስት እግር ተሽከርካሪ (ባጃጅ)', en: 'Three-wheeler' },
        family: 'passenger',
        needsSeats: true,
        needsLoad: false
    },
    {
        key: 'automobile',
        name: { am: 'አውቶሞቢል', en: 'Automobile' },
        family: 'passenger',
        needsSeats: true,
        needsLoad: false
    },
    {
        key: 'pickup',
        name: { am: 'ፒክአፕ', en: 'Pickup' },
        family: 'freight',
        needsSeats: false,
        needsLoad: true
    },
    {
        key: 'minibus',
        name: { am: 'ሚኒባስ', en: 'Minibus' },
        family: 'passenger',
        needsSeats: true,
        needsLoad: false
    },
    {
        key: 'midibus',
        name: { am: 'ሚዲባስ', en: 'Midibus' },
        family: 'passenger',
        needsSeats: true,
        needsLoad: false
    },
    {
        key: 'bus',
        name: { am: 'አውቶቡስ', en: 'Bus' },
        family: 'passenger',
        needsSeats: true,
        needsLoad: false
    },
    {
        key: 'light_truck',
        name: { am: 'ቀላል የጭነት መኪና', en: 'Light truck' },
        family: 'freight',
        needsSeats: false,
        needsLoad: true
    },
    {
        key: 'heavy_truck',
        name: { am: 'ከባድ የጭነት መኪና', en: 'Heavy truck' },
        family: 'freight',
        needsSeats: false,
        needsLoad: true
    },
    {
        key: 'tanker',
        name: { am: 'ቦቴ (የፈሳሽ ጭነት)', en: 'Tanker' },
        family: 'freight',
        needsSeats: false,
        needsLoad: true
    },
    {
        key: 'trailer',
        name: { am: 'ተሳቢ', en: 'Trailer' },
        family: 'freight',
        needsSeats: false,
        needsLoad: true
    },
    {
        key: 'semi_trailer',
        name: { am: 'ከፊል ተሳቢ', en: 'Semi-trailer' },
        family: 'freight',
        needsSeats: false,
        needsLoad: true
    },
    {
        key: 'tractor',
        name: { am: 'ትራክተር', en: 'Tractor' },
        family: 'special',
        needsSeats: false,
        needsLoad: false
    },
    {
        key: 'special_machinery',
        name: { am: 'ልዩ ማሽነሪ', en: 'Special machinery' },
        family: 'special',
        needsSeats: false,
        needsLoad: false
    }
];
