/**
 * The temporary driving permit and the card's handover (ADR-0064 §7, task 1.6d). A renewal accepted nationally (later a replacement
 * or an upgrade) gives the holder a permit letter while the region prints: a QR letter that stands for the region's days
 * (`competency.driving_permit_days`), never past the licence's term, numbered from the licence office's own counter. One stands at a
 * time: a later one supersedes the earlier. Handing over the card printed for it closes the permit: its document is revoked and its QR
 * reports so; a cancellation (task 1.6c) closes it too. The handover is the office's record: the card's serial, the recipient and the
 * ID they showed, the ID number (and a representative's name) encrypted and never in the audit log.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import { FIELD_CRYPTO, type FieldCrypto } from '@itrms/kernel/crypto';
import { insertAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { counterExists, nextNumber } from '@itrms/kernel/numbering';
import { withinScope } from '@itrms/kernel/org';
import { SettingsService } from '@itrms/kernel/settings';
import { DocumentsService, documentTemplates, issuedDocuments, revokeDocument } from '@itrms/documents/api';
import { persons } from '@itrms/parties/api';

import {
    addisDay,
    DRIVING_PERMIT_COUNTER,
    DRIVING_PERMIT_DAYS_SETTING,
    DRIVING_PERMIT_NO_COUNTER_NOTICE,
    DRIVING_PERMIT_TEMPLATE,
    foldCardSerial,
    type CardHandover,
    type CardHandoverOut
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { daysAfter } from './bolo-validity';
import {
    driverLicences,
    licenceCardHandovers,
    licenceGrades,
    licenceGradeTypes,
    licencePrintBatchItems
} from './competency.table';
import { restrictedOn } from './licence-restrictions';
import type { CasePlace } from './licences.service';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;
type IssuedRow = typeof issuedDocuments.$inferSelect;

const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

/** Where an ID is encrypted: bound to its column, its licence and its card, so a ciphertext copied to another row does not open. */
const sealedAt = (column: string, licenceId: string, serial: string) =>
    `competency.licence_card_handovers.${column}:${licenceId}:${serial}`;

const notEligible = (key: Words) => new ValidationError('not_eligible', { detail: say(key) });

/**
 * A licence's permit letters that stand (not superseded, not revoked), the latest first. A permit is its case's document (one per
 * renewal), and names its licence in its data, which is how a licence finds its permits.
 */
export async function standingPermitsOf(tx: Tx, licenceId: string): Promise<IssuedRow[]> {
    const rows = await tx
        .select({ document: issuedDocuments })
        .from(issuedDocuments)
        .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
        .where(
            and(
                eq(documentTemplates.key, DRIVING_PERMIT_TEMPLATE),
                sql`${issuedDocuments.data} -> 'licence' ->> 'id' = ${licenceId}`,
                isNull(issuedDocuments.supersededBy),
                isNull(issuedDocuments.revokedAt)
            )
        )
        .orderBy(desc(issuedDocuments.createdAt));
    return rows.map((r) => r.document);
}

/** The licence's standing permits, revoked with the reason: their QR says so from now on. Returns how many. */
export async function closePermits(tx: Tx, licenceId: string, reason: string): Promise<number> {
    const standing = await standingPermitsOf(tx, licenceId);
    for (const document of standing) await revokeDocument(tx, document, reason);
    return standing.length;
}

@Injectable()
export class DrivingPermitService {
    constructor(
        @Inject(DocumentsService) private readonly documents: DocumentsService,
        @Inject(SettingsService) private readonly settings: SettingsService,
        @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto
    ) {}

    /**
     * The permit letter, on the step that sends the card to print: the licence as the case left it. Nothing for a licence the
     * services refuse (cancelled or suspended since, task 1.6c): there is no card coming to wait for. The step taken again gives
     * the same letter, and takes no second number.
     */
    async issue(tx: Tx, place: CasePlace, caseNumber: number, facts: Facts) {
        const licenceId = (facts.licence as { id?: unknown } | undefined)?.id;
        const known = (facts.documents ?? {}) as Record<string, string>;
        if (typeof licenceId !== 'string') return { documents: known };
        const [mine] = await tx
            .select({ id: issuedDocuments.id })
            .from(issuedDocuments)
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(and(eq(documentTemplates.key, DRIVING_PERMIT_TEMPLATE), eq(issuedDocuments.caseId, place.caseId)));
        if (mine) return { documents: { ...known, [DRIVING_PERMIT_TEMPLATE]: mine.id } };
        const [licence] = await tx.select().from(driverLicences).where(eq(driverLicences.id, licenceId));
        if (!licence) throw new NotFoundError();
        const today = addisDay();
        if (licence.status !== 'active' || !licence.number || (await restrictedOn(tx, licence.id, today)))
            return { documents: known };
        // the licence's own office gives it, whoever took the step: that office's desk hands the card over and closes it
        const office = licence.handlingUnitId;
        // an office given DVC-04 without its counter: no permit rather than no renewal; the case says so
        if (!(await counterExists(tx, DRIVING_PERMIT_COUNTER, office)))
            return { documents: known, drivingPermit: { notices: [DRIVING_PERMIT_NO_COUNTER_NOTICE] } };
        const [holder] = await tx.select().from(persons).where(eq(persons.id, licence.personId));
        if (!holder) throw new NotFoundError();
        const grades = await tx
            .select({ key: licenceGradeTypes.key, name: licenceGradeTypes.name })
            .from(licenceGrades)
            .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, licenceGrades.gradeTypeId))
            .where(eq(licenceGrades.licenceId, licence.id));
        const days = await this.settings.value<number>(tx, office, DRIVING_PERMIT_DAYS_SETTING);
        // it stands its days, the first one included, and never past the licence's own term
        const last = daysAfter(today, days - 1);
        const validUntil = licence.validUntil && licence.validUntil < last ? licence.validUntil : last;
        const language = currentContext()?.language === 'en' ? 'en' : 'am';
        const { number } = await nextNumber(tx, DRIVING_PERMIT_COUNTER, office);
        const data = {
            number,
            issuedOn: today,
            validUntil,
            caseNumber,
            holderName: [holder.givenNameAm, holder.fatherNameAm, holder.grandfatherNameAm].filter(Boolean).join(' '),
            licence: {
                id: licence.id,
                number: licence.number,
                validUntil: licence.validUntil,
                grades: grades.map((g) => ({ grade: g.key, name: g.name }))
            }
        };
        const subject = { table: 'workflow.cases', id: place.caseId };
        // one permit stands at a time: a later one supersedes the earlier, whose QR then says so
        const [earlier] = await standingPermitsOf(tx, licence.id);
        const letter = earlier
            ? await this.documents.supersede(tx, earlier.id, { data, language, number, caseId: place.caseId, subject })
            : await this.documents.issue(tx, {
                  regionId: place.regionId,
                  handlingUnitId: office,
                  templateKey: DRIVING_PERMIT_TEMPLATE,
                  language,
                  number,
                  caseId: place.caseId,
                  subject,
                  data
              });
        return { documents: { ...known, [DRIVING_PERMIT_TEMPLATE]: letter.id } };
    }

    /**
     * The card handed over, at the licence's office (or one above it): the serial must be the one the region printed for the licence
     * after its standing permit (an older card does not close it), once. The licence's standing permits close in the same
     * transaction. Its row is locked, so two handovers take turns.
     */
    async handOver(
        tx: Tx,
        ctx: DbContext,
        licenceId: string,
        version: number,
        input: CardHandover
    ): Promise<CardHandoverOut> {
        const userId = ctx.userId;
        if (!userId) throw new ForbiddenError();
        const [licence] = await tx.select().from(driverLicences).where(eq(driverLicences.id, licenceId)).for('update');
        // the register is the region's to read, its office's subtree's to act on: anywhere else it is not found
        if (!licence || !withinScope(licence.handlingOrgPath, ctx.scopePath ?? '')) throw new NotFoundError();
        // the version the desk saw: a licence changed since (renewed, restricted) is looked at again first
        if (licence.rowVersion !== version) throw new ConflictError('stale_version');
        if (licence.status !== 'active') throw notEligible('competency.rule.notHandedOver');
        if (await restrictedOn(tx, licence.id, addisDay())) throw notEligible('competency.rule.licenceSuspended');
        if (!licence.cardSerial)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.card_not_printed' });
        const serial = foldCardSerial(input.cardSerial);
        if (serial !== licence.cardSerial)
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'cardSerial', code: 'not_this_card', message: say('competency.rule.handoverSerial') }]
            });
        // the card the region printed for it: recorded back from the printer (its batch item's card key) no earlier than the permit it
        // closes, so an older card, printed before the renewal, never closes the new permit
        const printed = (
            await tx
                .select({ cardKey: licencePrintBatchItems.cardKey, at: licencePrintBatchItems.updatedAt })
                .from(licencePrintBatchItems)
                .where(eq(licencePrintBatchItems.licenceId, licence.id))
                .orderBy(desc(licencePrintBatchItems.updatedAt))
        ).find((p) => p.cardKey !== null && foldCardSerial(p.cardKey) === serial);
        if (!printed)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.card_not_printed' });
        const [permit] = await standingPermitsOf(tx, licence.id);
        if (permit && printed.at < permit.createdAt)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.card_before_permit' });
        const [already] = await tx
            .select({ id: licenceCardHandovers.id })
            .from(licenceCardHandovers)
            .where(and(eq(licenceCardHandovers.licenceId, licence.id), eq(licenceCardHandovers.cardSerial, serial)));
        if (already)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.card_already_handed_over' });

        const sealed = (column: string, value: string) =>
            this.crypto.encrypt(tx, licence.regionId, sealedAt(column, licence.id, serial), value);
        const handedOverAt = new Date();
        const row = await insertAudited(tx, licenceCardHandovers, {
            regionId: licence.regionId,
            handlingUnitId: licence.handlingUnitId,
            licenceId: licence.id,
            cardSerial: serial,
            recipient: input.recipient,
            idKind: input.idKind,
            idNumberCt: await sealed('id_number', input.idNumber.trim().toUpperCase()),
            representativeNameCt: input.representativeName
                ? await sealed('representative_name', input.representativeName)
                : null,
            handedOverBy: userId,
            handedOverAt
        });
        return {
            id: row.id,
            licenceId: licence.id,
            cardSerial: serial,
            recipient: input.recipient,
            idKind: input.idKind,
            handedOverAt: handedOverAt.toISOString(),
            permitsClosed: await closePermits(tx, licence.id, 'card_handed_over')
        };
    }
}
