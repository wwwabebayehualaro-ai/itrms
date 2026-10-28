/**
 * @itrms/kernel/notifications (task 0.20a): writing a message to a person (in-app, and an SMS through a port) and the
 * person's own list. The worker writes them from its system context (an overdue step, an escalation); the list is read
 * through the reviewed `kernel.my_notifications` only.
 */
import { Logger } from '@nestjs/common';

import type { Tx } from '../db';
import { notifications } from './notifications.table';

export { notifications } from './notifications.table';
export { NotificationsController } from './notifications.controller';

export interface Notice {
    userId: string;
    regionId: string;
    /** the unit the message is about */
    unitId: string;
    /** `<slice>.notify.<kind>` */
    messageKey: string;
    params: Record<string, string>;
    link?: Record<string, string>;
}

/** An SMS gateway (Ethio telecom, Safaricom, an aggregator: Phase 1). `to` is the person; the adapter finds the number. */
export interface SmsSender {
    send(message: { userId: string; text: string }): Promise<void>;
}

/** The development and demo gateway: logs what it would send, sends nothing. */
export class FakeSms implements SmsSender {
    private readonly log = new Logger('FakeSms');
    readonly sent: { userId: string; text: string }[] = [];

    send(message: { userId: string; text: string }): Promise<void> {
        this.sent.push(message);
        this.log.log(`SMS to ${message.userId}: ${message.text}`);
        return Promise.resolve();
    }
}

/** Writes notices in the caller's transaction (the worker's system context): they commit with what they tell. */
export async function notify(tx: Tx, notices: readonly Notice[]): Promise<void> {
    if (notices.length === 0) return;
    await tx.insert(notifications).values(
        notices.map((n) => ({
            regionId: n.regionId,
            userId: n.userId,
            unitId: n.unitId,
            messageKey: n.messageKey,
            params: n.params,
            link: n.link ?? null
        }))
    );
}
