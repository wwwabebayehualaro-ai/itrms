/**
 * A receipt's document (task 0.23a), in the main worker: on `receipt.issued.v1`, the document is issued for the receipt and its
 * rendering queued for the PDF worker. An installation without the template keeps its receipt: the money is recorded either
 * way, and a document can be made once the template is set up.
 */
import { eq } from 'drizzle-orm';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { actFor } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { ConflictError } from '@itrms/kernel/errors';
import { orgUnits } from '@itrms/kernel/tables';
import type { SettingsService } from '@itrms/kernel/settings';
import type { ReceiptOut } from '@itrms/fees/contracts';
import type { Tx } from '@itrms/kernel/db';
import { FEES_EVENTS } from '@itrms/fees/contracts';

import { addisDay, issueDocument } from '../issue';

export interface ReceiptSource {
    /** the receipt as the fees slice tells it */
    receipt(tx: Tx, id: string): Promise<ReceiptOut>;
    settings: Pick<SettingsService, 'value'>;
}

export async function issueReceiptDocument(
    system: SystemDatabase,
    deps: ReceiptSource,
    receiptId: string
): Promise<boolean> {
    return system.systemContext('documents.receipt', async (tx) => {
        const receipt = await deps.receipt(tx, receiptId);
        const [unit] = await tx
            .select({ regionId: orgUnits.regionId, path: orgUnits.path })
            .from(orgUnits)
            .where(eq(orgUnits.id, receipt.unit.id));
        if (!unit) return false;
        actFor(tx, { regionId: unit.regionId, unitId: receipt.unit.id, scopePath: unit.path });
        try {
            await issueDocument(tx, deps.settings, {
                regionId: unit.regionId,
                handlingUnitId: receipt.unit.id,
                templateKey: 'receipt',
                language: 'am',
                caseId: receipt.caseId,
                subject: { table: 'fees.receipts', id: receipt.id },
                number: receipt.number,
                data: {
                    number: receipt.number,
                    issuedOn: addisDay(new Date(receipt.issuedAt)),
                    caseNumber: receipt.caseNumber,
                    serviceName: receipt.serviceName,
                    receivedFrom: receipt.receivedFrom,
                    method: receipt.method,
                    amountSantim: receipt.amountSantim,
                    lines: receipt.lines.map((l) => ({
                        label: l.label,
                        quantity: l.quantity,
                        amountSantim: l.amountSantim
                    })),
                    demo: receipt.demo
                }
            });
            return true;
        } catch (error) {
            if (error instanceof ConflictError && error.code === 'not_configured') return false;
            throw error;
        }
    });
}

export function documentsHandlers(system: SystemDatabase, deps: ReceiptSource): Record<string, OutboxHandler> {
    return {
        'receipt.issued.v1': async (job) => {
            await issueReceiptDocument(system, deps, FEES_EVENTS['receipt.issued.v1'].parse(job.payload).receiptId);
        }
    };
}
