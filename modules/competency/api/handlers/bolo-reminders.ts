/**
 * The bolo's renewal reminder (task 1.3b): due a set number of days before a bolo's last day (the event waited in the outbox until
 * then), it tells the vehicle's owners by SMS, once, if the bolo still stands. Each owner's phone is read from the register for this
 * and the read is recorded; an owner without one, or an organisation, gets nothing. The bolo is marked in the same transaction and
 * the messages go out after the commit: a failed transaction sends nothing, a retry never sends twice.
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { actFor, updateAudited, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import type { SmsToNumber } from '@itrms/kernel/notifications';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { orgUnits } from '@itrms/kernel/tables';
import { plateAssignments, vehicleOwners, vehicleOwnerships } from '@itrms/vehicles/api';

import { addisDay, COMPETENCY_EVENTS } from '../../contracts';
import { reminderText } from '../bolo-validity';
import { bolos } from '../competency.table';

export interface BoloReminderDeps {
    sms: SmsToNumber;
    /** a person's phone, its read recorded (the register's `phoneForNotice`) */
    phones: { phoneForNotice(tx: Tx, regionId: string, id: string, reason: string): Promise<string | null> };
}

const REASON = 'competency.bolo_reminder';

/** Reminds a bolo's owners. False when there is nothing to do: reminded already, no longer standing, or past its last day. */
export async function remindBoloExpiring(
    system: SystemDatabase,
    deps: BoloReminderDeps,
    boloId: string
): Promise<boolean> {
    const messages = await system.systemContext(REASON, async (tx) => {
        const [bolo] = await tx
            .select()
            .from(bolos)
            .where(and(eq(bolos.id, boloId), isNull(bolos.remindedAt)))
            .for('update');
        if (bolo?.status !== 'valid' || bolo.validUntil < addisDay()) return null;
        const [unit] = await tx
            .select({ path: orgUnits.path })
            .from(orgUnits)
            .where(eq(orgUnits.id, bolo.handlingUnitId));
        actFor(tx, { regionId: bolo.regionId, unitId: bolo.handlingUnitId, scopePath: unit?.path ?? '' });
        await updateAudited(tx, bolos, bolo.id, bolo.rowVersion, { remindedAt: new Date() });
        const [plate] = await tx
            .select({ text: plateAssignments.plateText })
            .from(plateAssignments)
            .where(and(eq(plateAssignments.vehicleId, bolo.vehicleId), isNull(plateAssignments.until)));
        // the holders of the open ownership period: the people (an organisation's contact is not in the register yet)
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
        const text = reminderText(plate?.text ?? '', bolo.validUntil);
        const out: { phone: string; text: string }[] = [];
        for (const { personId } of owners) {
            if (!personId) continue;
            const phone = await deps.phones.phoneForNotice(tx, bolo.regionId, personId, REASON);
            if (phone) out.push({ phone, text });
        }
        return out;
    });
    if (!messages) return false;
    for (const m of messages) await deps.sms.sendToNumber(m);
    return true;
}

/** The bolo's handlers: the renewal reminder, when its event comes due. */
export function boloHandlers(system: SystemDatabase, deps: BoloReminderDeps): Record<string, OutboxHandler> {
    return {
        'bolo.expiring.v1': async (job) => {
            await remindBoloExpiring(system, deps, COMPETENCY_EVENTS['bolo.expiring.v1'].parse(job.payload).boloId);
        }
    };
}
