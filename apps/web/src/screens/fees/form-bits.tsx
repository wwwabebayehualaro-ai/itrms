'use client';

/** What the payment screens' forms share: today in Addis Ababa, and a field's messages. */
import { addisDate } from '@itrms/ethiopian-calendar';
import { FieldError } from '@itrms/ui';

/** Today's date in Addis Ababa (YYYY-MM-DD): a slip or a receipt is not dated after it. */
export const todayInAddis = () => {
    const { year, month, day } = addisDate(new Date());
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** The messages of a field's Zod issues (once each), after the person has left it. */
export function ErrorsOf({ errors, touched }: { errors: unknown[]; touched: boolean }) {
    if (!touched) return null;
    const messages = [
        ...new Set(
            errors
                .map((e) =>
                    typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e ? String(e.message) : null
                )
                .filter((m): m is string => !!m)
        )
    ];
    return messages.length > 0 ? <FieldError>{messages.join(' ')}</FieldError> : null;
}
