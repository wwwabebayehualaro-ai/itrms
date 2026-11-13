/**
 * A person's phone for a message the worker sends them (a bolo's renewal reminder, task 1.3b): nobody is shown it, and no request
 * reaches it. It is exported only from the worker entry, so the HTTP process cannot call it (dependency-cruiser:
 * worker-code-only-from-worker-entries); a person on screen is revealed through `PersonsService.reveal`, with `pii:reveal`. The
 * read is recorded with what it does, in the worker's system transaction, like a rule's read of the birth date.
 */
import { eq } from 'drizzle-orm';
import type { FieldCrypto } from '@itrms/kernel/crypto';
import { recordEvent, type Tx } from '@itrms/kernel/db';

import { personSensitive } from './parties.table';

export async function phoneForNotice(
    tx: Tx,
    crypto: FieldCrypto,
    regionId: string,
    personId: string,
    reason: string
): Promise<string | null> {
    await recordEvent(tx, {
        type: 'person.revealed',
        table: personSensitive,
        rowId: personId,
        data: { fields: ['phone'], reason }
    });
    const [row] = await tx
        .select({ phoneCt: personSensitive.phoneCt })
        .from(personSensitive)
        .where(eq(personSensitive.personId, personId));
    // the same place the register encrypted it under (persons.service.ts)
    return row?.phoneCt
        ? crypto.decrypt(tx, regionId, `parties.person_sensitive.phone:${personId}`, row.phoneCt)
        : null;
}
