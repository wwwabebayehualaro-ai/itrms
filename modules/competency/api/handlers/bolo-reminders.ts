/**
 * The bolo's renewal reminder (task 1.3b), in two steps through the outbox:
 *   - `bolo.expiring.v1`, due a set number of days before a bolo's last day: if the bolo still stands and was not reminded, it is
 *     marked and one `bolo-reminder.sms-due.v1` is written per owner (the people of the open ownership period; an organisation's
 *     contact is not in the register yet), in one transaction;
 *   - `bolo-reminder.sms-due.v1`: the owner's phone, read from the register for this and the read recorded, and the SMS, sent after
 *     the commit. A gateway that fails throws: the outbox retries that owner alone, and the others are not sent twice.
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FieldCrypto } from '@itrms/kernel/crypto';
import { actFor, updateAudited } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import type { SmsToNumber } from '@itrms/kernel/notifications';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { emit } from '@itrms/kernel/outbox';
import { orgUnits } from '@itrms/kernel/tables';
import { phoneForNotice } from '@itrms/parties/api/worker';
import { plateAssignments, vehicleOwners, vehicleOwnerships } from '@itrms/vehicles/api';

import { addisDay, COMPETENCY_EVENTS } from '../../contracts';
import { reminderText } from '../bolo-validity';
import { bolos } from '../competency.table';

export interface BoloReminderDeps {
    sms: SmsToNumber;
    /** the field encryption the register's phones are under */
    crypto: FieldCrypto;
}

const REASON = 'competency.bolo_reminder';

/**
 * Marks a due bolo reminded and asks for one SMS per owner; returns how many. False when there is nothing to do: reminded already,
 * no longer standing, or past its last day.
 */
export async function remindBoloExpiring(system: SystemDatabase, boloId: string): Promise<number | false> {
    return system.systemContext(REASON, async (tx) => {
        const [bolo] = await tx
            .select()
            .from(bolos)
            .where(and(eq(bolos.id, boloId), isNull(bolos.remindedAt)))
            .for('update');
        if (bolo?.status !== 'valid' || bolo.validUntil < addisDay()) return false;
        const [unit] = await tx
            .select({ path: orgUnits.path })
            .from(orgUnits)
            .where(eq(orgUnits.id, bolo.handlingUnitId));
        actFor(tx, { regionId: bolo.regionId, unitId: bolo.handlingUnitId, scopePath: unit?.path ?? '' });
        await updateAudited(tx, bolos, bolo.id, bolo.rowVersion, { remindedAt: new Date() });
        const owners = await tx
            .select({ personId: vehicleOwners.personId })
            .from(vehicleOwners)
            .innerJoin(vehicleOwnerships, eq(vehicleOwnerships.id, vehicleOwners.ownershipId))
            .where(
                and(
                    eq(vehicleOwnerships.vehicleId, bolo.vehicleId),
                    isNull(vehicleOwnerships.until),
                    isNotNull(vehicleOwners.personId)
                )
            );
        let asked = 0;
        for (const { personId } of owners) {
            if (!personId) continue;
            await emit(
                tx,
                'bolo-reminder.sms-due.v1',
                { boloId: bolo.id, personId },
                { unitId: bolo.handlingUnitId, regionId: bolo.regionId }
            );
            asked += 1;
        }
        return asked;
    });
}

/** One owner's reminder: false when the owner has no phone on record (nothing is sent). */
export async function sendBoloReminder(
    system: SystemDatabase,
    deps: BoloReminderDeps,
    event: { boloId: string; personId: string }
): Promise<boolean> {
    const message = await system.systemContext(REASON, async (tx) => {
        const [bolo] = await tx.select().from(bolos).where(eq(bolos.id, event.boloId));
        if (!bolo) return null;
        // the read is recorded as the bolo's office's (an event needs a unit)
        const [unit] = await tx
            .select({ path: orgUnits.path })
            .from(orgUnits)
            .where(eq(orgUnits.id, bolo.handlingUnitId));
        actFor(tx, { regionId: bolo.regionId, unitId: bolo.handlingUnitId, scopePath: unit?.path ?? '' });
        const [plate] = await tx
            .select({ text: plateAssignments.plateText })
            .from(plateAssignments)
            .where(and(eq(plateAssignments.vehicleId, bolo.vehicleId), isNull(plateAssignments.until)));
        const phone = await phoneForNotice(tx, deps.crypto, bolo.regionId, event.personId, REASON);
        return phone ? { phone, text: reminderText(plate?.text ?? '', bolo.validUntil) } : null;
    });
    if (!message) return false;
    // after the commit; a failure throws and the outbox sends this owner's again
    await deps.sms.sendToNumber(message);
    return true;
}

/** The bolo's handlers: the reminder when it comes due, and each owner's SMS. */
export function boloHandlers(system: SystemDatabase, deps: BoloReminderDeps): Record<string, OutboxHandler> {
    return {
        'bolo.expiring.v1': async (job) => {
            await remindBoloExpiring(system, COMPETENCY_EVENTS['bolo.expiring.v1'].parse(job.payload).boloId);
        },
        'bolo-reminder.sms-due.v1': async (job) => {
            await sendBoloReminder(system, deps, COMPETENCY_EVENTS['bolo-reminder.sms-due.v1'].parse(job.payload));
        }
    };
}
