'use client';

/** Small parts the vehicle screens share (task 1.1b). */
import Link from 'next/link';
import type { Tone } from '@itrms/ui';
import type { VehicleSummary } from '@/lib/vehicles';

type Holder = VehicleSummary['owners'][number];
type Text = (value: Record<string, string>) => string;

export const STATUS_TONE: Record<VehicleSummary['status'], Tone> = {
    active: 'success',
    transferred_out: 'muted',
    deregistered: 'muted',
    stolen: 'danger'
};

/** A holder's name in the reader's language (both names are kept). */
export const holderName = (holder: Holder, text: Text): string => text({ ...holder.name });

/** A holder, linked to its record in the register of persons or organisations. */
export function HolderLink({ holder, text }: { holder: Holder; text: Text }) {
    const href = holder.kind === 'person' ? `/registry/persons/${holder.id}` : `/registry/organisations/${holder.id}`;
    return (
        <Link href={href} className="hover:underline" data-holder={holder.id}>
            {holderName(holder, text)}
        </Link>
    );
}
