/**
 * A remittance's document (task 1.12d), in the main worker: on `remittance.prepared.v1` the document is issued and its rendering
 * queued for the PDF worker. An installation without the template keeps its remittance: the money is recorded either way.
 */
import { eq } from 'drizzle-orm';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { actFor } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { ConflictError } from '@itrms/kernel/errors';
import { orgUnits } from '@itrms/kernel/tables';
import type { SettingsService } from '@itrms/kernel/settings';
import type { RemittanceDetail } from '@itrms/fees/contracts';
import type { Tx } from '@itrms/kernel/db';
import { FEES_EVENTS } from '@itrms/fees/contracts';

import { addisDay, issueDocument } from '../issue';

export interface RemittanceSource {
    /** the remittance as the fees slice tells it */
    remittance(tx: Tx, id: string): Promise<RemittanceDetail>;
    settings: Pick<SettingsService, 'value'>;
}

export async function issueRemittanceDocument(
    system: SystemDatabase,
    deps: RemittanceSource,
    remittanceId: string
): Promise<boolean> {
    return system.systemContext('documents.remittance', async (tx) => {
        const r = await deps.remittance(tx, remittanceId);
        const [unit] = await tx
            .select({ regionId: orgUnits.regionId, path: orgUnits.path })
            .from(orgUnits)
            .where(eq(orgUnits.id, r.unit.id));
        if (!unit) return false;
        actFor(tx, { regionId: unit.regionId, unitId: r.unit.id, scopePath: unit.path });
        try {
            await issueDocument(tx, deps.settings, {
                regionId: unit.regionId,
                handlingUnitId: r.unit.id,
                templateKey: 'remittance',
                language: 'am',
                subject: { table: 'fees.remittances', id: r.id },
                number: r.number,
                data: {
                    number: r.number,
                    preparedOn: addisDay(new Date(r.preparedAt)),
                    periodFrom: r.periodFrom,
                    periodTo: r.periodTo,
                    revenueTotalSantim: r.revenueTotalSantim,
                    cashSantim: r.cashSantim,
                    bankSlipSantim: r.bankSlipSantim,
                    reversalSantim: r.reversalSantim,
                    depositDueSantim: r.depositDueSantim,
                    differenceSantim: r.differenceSantim,
                    groups: r.groups.map((g) => ({
                        accountCode: g.accountCode,
                        budgetCategory: g.budgetCategory,
                        accountName: g.accountName,
                        mappedByDefault: g.mappedByDefault,
                        receiptSantim: g.receiptSantim,
                        reversalSantim: g.reversalSantim,
                        totalSantim: g.totalSantim
                    })),
                    lines: r.lines.map((l) => ({
                        kind: l.kind,
                        receiptNumber: l.receiptNumber,
                        lineKey: l.lineKey,
                        accountCode: l.accountCode,
                        mappedByDefault: l.mappedByDefault,
                        amountSantim: l.amountSantim
                    })),
                    sessions: r.sessions.map((s) => ({
                        businessDay: s.businessDay,
                        openingFloatSantim: s.openingFloatSantim,
                        expectedCashSantim: s.expectedCashSantim,
                        countedSantim: s.countedSantim,
                        differenceSantim: s.differenceSantim
                    })),
                    demo: r.demo
                }
            });
            return true;
        } catch (error) {
            if (error instanceof ConflictError && error.code === 'not_configured') return false;
            throw error;
        }
    });
}

export function remittanceHandlers(system: SystemDatabase, deps: RemittanceSource): Record<string, OutboxHandler> {
    return {
        'remittance.prepared.v1': async (job) => {
            await issueRemittanceDocument(
                system,
                deps,
                FEES_EVENTS['remittance.prepared.v1'].parse(job.payload).remittanceId
            );
        }
    };
}
