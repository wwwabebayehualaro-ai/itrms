/**
 * The temporary driving permit and the card's handover (ADR-0064 §7, task 1.6d). While the region prints, a renewal (and later the
 * replacement and the upgrade) gives the holder a permit letter with a QR and a validity window, so they may drive on it until their
 * card comes. Handing the card over closes the permit: its document is revoked and its QR reports so. The handover records the serial
 * printed on the card and who received it, with their ID (the ID number encrypted: personal data).
 */
import { z } from 'zod';

import { CARD_SERIAL_MAX } from './licence-family';

export const DRIVING_PERMIT_EFFECTS = { issueDrivingPermit: 'competency.issueDrivingPermit' } as const;

/** How many days a permit stands (ADR-0064 §7: 90, a placeholder until the region says, Z). */
export const DRIVING_PERMIT_DAYS_SETTING = 'competency.driving_permit_days';
export const drivingPermitDaysSchema = z.number().int().min(1).max(365);

export const DRIVING_PERMIT_COUNTER = 'competency.driving-permit';
export const DRIVING_PERMIT_PATTERN = '{unit}/TP/{seq:05}/{efy}';
export const DRIVING_PERMIT_TEMPLATE = 'licence-driving-permit';

/** Who took the card: the holder, or someone they sent with a letter. */
export const HANDOVER_RECIPIENTS = ['holder', 'representative'] as const;
/** The ID the recipient showed (Fayda, the kebele ID, a passport, a driver licence of their own). */
export const RECIPIENT_ID_KINDS = ['fayda', 'kebele_id', 'passport', 'driver_licence'] as const;
export const RECIPIENT_ID_MAX = 40;

/** An ID number as typed: 1–40 letters, digits, '-' or '/' (checked character by character, SEC regex_dos). */
export function isIdNumber(text: string): boolean {
    if (text.length < 1 || text.length > RECIPIENT_ID_MAX) return false;
    for (const c of text) {
        const ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-' || c === '/';
        if (!ok) return false;
    }
    return true;
}

/** The handover as the desk records it. */
export const cardHandoverSchema = z
    .strictObject({
        /** the serial printed on the card handed over: it must be the licence's */
        cardSerial: z.string().trim().min(1).max(CARD_SERIAL_MAX),
        recipient: z.enum(HANDOVER_RECIPIENTS),
        /** a representative's name, as on their ID (personal: encrypted) */
        representativeName: z.string().trim().min(2).max(120).optional(),
        idKind: z.enum(RECIPIENT_ID_KINDS),
        idNumber: z.string().trim().refine(isIdNumber, 'is 1–40 letters, digits, "-" or "/"')
    })
    .refine((h) => (h.recipient === 'representative') === (h.representativeName !== undefined), {
        path: ['representativeName'],
        message: 'a representative is named, the holder is not'
    });
export type CardHandover = z.infer<typeof cardHandoverSchema>;

export const cardHandoverOutSchema = z.object({
    id: z.uuid(),
    licenceId: z.uuid(),
    cardSerial: z.string(),
    recipient: z.enum(HANDOVER_RECIPIENTS),
    idKind: z.enum(RECIPIENT_ID_KINDS),
    handedOverAt: z.string(),
    /** how many permit letters the handover closed */
    permitsClosed: z.number().int()
});
export type CardHandoverOut = z.infer<typeof cardHandoverOutSchema>;
