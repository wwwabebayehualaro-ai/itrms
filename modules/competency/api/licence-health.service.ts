/**
 * A licence's blood group (task 1.6, ADR-0052, ADR-0064 §4): a health fact, never a form answer. Recorded by a register command
 * when the region collects it, encrypted with the region's data key and bound to its row; read in clear only through the audited
 * reveal, by the competency lead, for licences handled in the lead's subtree. The audit log says that it was recorded or changed,
 * never to what.
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE } from '@itrms/kernel/api';
import { FIELD_CRYPTO, reveal, type FieldCrypto } from '@itrms/kernel/crypto';
import { insertAudited, updateAudited, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { withinScope } from '@itrms/kernel/org';
import { SettingsService } from '@itrms/kernel/settings';

import {
    BLOOD_GROUPS,
    CARD_SHOWS_BLOOD_GROUP_SETTING,
    LICENCE_HEALTH_REVEALED_EVENT,
    type BloodGroup,
    type LicenceHealthRevealed
} from '../contracts';
import { driverLicences, licenceHealth } from './competency.table';

/** Where the value is encrypted: bound to its column and its licence, so a ciphertext copied to another row does not open. */
const place = (licenceId: string) => `competency.licence_health.blood_group:${licenceId}`;

const isBloodGroup = (value: string): value is BloodGroup => (BLOOD_GROUPS as readonly string[]).includes(value);

/** A person acting always has a region and a unit: the guards saw to that. */
function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError();
    return value;
}

@Injectable()
export class LicenceHealthService {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    /** The licence, when the caller's active subtree handles it (a licence elsewhere in the region is "not found" here). */
    private async handled(tx: Tx, ctx: DbContext, licenceId: string) {
        const [licence] = await tx.select().from(driverLicences).where(eq(driverLicences.id, licenceId));
        if (!licence || !withinScope(licence.handlingOrgPath, required(ctx.scopePath))) throw new NotFoundError();
        return licence;
    }

    /**
     * Records (or corrects) the blood group: refused (409) while the region does not collect it. A correction is an audited update
     * like the first record; neither holds the value.
     */
    async record(tx: Tx, ctx: DbContext, licenceId: string, bloodGroup: BloodGroup): Promise<void> {
        const regionId = required(ctx.regionId);
        const licence = await this.handled(tx, ctx, licenceId);
        if (licence.status === 'voided') throw new NotFoundError();
        const collected = await this.settings.value<boolean>(
            tx,
            licence.handlingUnitId,
            CARD_SHOWS_BLOOD_GROUP_SETTING
        );
        if (collected !== true)
            throw new ConflictError('not_configured', { detailKey: 'competency.errors.blood_group_not_collected' });
        const ciphertext = await this.crypto.encrypt(tx, regionId, place(licence.id), bloodGroup);
        const [existing] = await tx
            .select({ id: licenceHealth.id, rowVersion: licenceHealth.rowVersion })
            .from(licenceHealth)
            .where(eq(licenceHealth.licenceId, licence.id))
            .for('update');
        if (existing)
            await updateAudited(tx, licenceHealth, existing.id, existing.rowVersion, {
                bloodGroupCt: ciphertext,
                handlingUnitId: licence.handlingUnitId
            });
        else
            await insertAudited(tx, licenceHealth, {
                regionId,
                handlingUnitId: licence.handlingUnitId,
                licenceId: licence.id,
                bloodGroupCt: ciphertext
            });
    }

    /**
     * The blood group in clear, for the competency lead: the request (who, which licence, why) is recorded first in a transaction
     * of its own, so it stays on record whatever happens next; only then is the licence checked to be the lead's to read.
     */
    revealed(ctx: DbContext, licenceId: string, reason: string): Promise<LicenceHealthRevealed> {
        const regionId = required(ctx.regionId);
        return reveal(
            this.db,
            ctx,
            {
                type: LICENCE_HEALTH_REVEALED_EVENT,
                table: driverLicences,
                rowId: licenceId,
                fields: ['bloodGroup'],
                reason
            },
            async (tx) => {
                const licence = await this.handled(tx, ctx, licenceId);
                const [row] = await tx.select().from(licenceHealth).where(eq(licenceHealth.licenceId, licence.id));
                if (!row) return { bloodGroup: null };
                const value = await this.crypto.decrypt(tx, regionId, place(licence.id), row.bloodGroupCt);
                return { bloodGroup: isBloodGroup(value) ? value : null };
            }
        );
    }
}
