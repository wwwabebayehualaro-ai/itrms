/**
 * The transfer of a vehicle out of its office (task 1.4c, DVC-14 and DVC-15, ADR-0057, ADR-0058). The transfer out, filed where
 * the vehicle is handled, names where it goes. For an office of the region it releases the vehicle to that office; the transfer in,
 * filed there, receives it, and the register's reviewed command moves the vehicle and its live records (VehicleHandovers). For
 * another region, or an office without ITRMS, it issues the vehicle data transfer document and the vehicle reads transferred out
 * (nothing else changes). Each step checks what it relies on again; the register's command checks it once more, as the last word.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { AppError, ValidationError } from '@itrms/kernel/errors';
import { nextNumber, requireCounter } from '@itrms/kernel/numbering';
import { unitRefs } from '@itrms/kernel/org';
import { SettingsService } from '@itrms/kernel/settings';
import { orgUnits } from '@itrms/kernel/tables';
import { DocumentsService, documentTemplates, issuedDocuments } from '@itrms/documents/api';
import { OrganisationsService } from '@itrms/parties/api';
import {
    vehicleEncumbrances,
    vehicleHandovers,
    vehicles,
    VehicleHandovers,
    VehiclesService
} from '@itrms/vehicles/api';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import {
    addisDay,
    DEFAULT_VEHICLE_TRANSFER_DAYS,
    MAX_TRANSFER_DOCUMENT_BIRR,
    TRANSFER_IN_SERVICE,
    transferDocumentEntrySchema,
    transferInspectionEntrySchema,
    VEHICLE_TRANSFER_COVERING_LETTER_SETTING,
    VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE,
    VEHICLE_TRANSFER_DOCUMENT_COUNTER,
    VEHICLE_TRANSFER_DOCUMENT_TEMPLATE,
    VEHICLE_TRANSFER_REINSPECT_SETTING,
    VEHICLE_TRANSFER_VALID_DAYS_SETTING
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { daysAfter } from './bolo-validity';
import { bolos } from './competency.table';
import { actForHandlingOffice, claimedElsewhere, lockVehicleClaim } from './handling-office';
import type { CasePlace } from './licences.service';
import { VehicleRegistrationService } from './registration.service';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

type Refusal = { path: string; code: string; key: Words };

const refuseAll = (refusals: readonly Refusal[]): never => {
    throw new ValidationError('validation_failed', {
        errors: refusals.map((r) => ({ path: r.path, code: r.code, message: say(r.key) }))
    });
};

const refuse = (path: string, code: string, key: Words): never => refuseAll([{ path, code, key }]);

const notEligible = (key: Words): never => {
    throw new ValidationError('not_eligible', { detail: say(key), detailKey: key });
};

const factObject = (facts: Facts, key: string): Record<string, unknown> | undefined => {
    const value = facts[key];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
};

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const words = (key: string): { am: string; en: string } => ({
    am: (vehiclesAm as Record<string, string>)[key] ?? key,
    en: (vehiclesEn as Record<string, string>)[key] ?? key
});

/** Whole Birr as the owner's papers give it, in santim (as the committee's valuation: a figure out of range is refused where typed). */
function santim(path: string, birr: number): string {
    if (!Number.isSafeInteger(birr) || birr < 1 || birr > MAX_TRANSFER_DOCUMENT_BIRR)
        return refuse(path, 'out_of_range', 'competency.rule.transferDocumentAmount');
    return (BigInt(birr) * 100n).toString();
}

/** What the transfer out's request names (see vehicle-transfer.effects.ts): the office, or the body outside the region. */
export type TransferOutInput = {
    vehicle: string;
    toOffice?: string;
    /** 'office' (the default) or 'outside' */
    destination?: string;
    destinationName?: string;
    destinationRegion?: string;
};
/** What the transfer in's request names. */
export type TransferInInput = { vehicle: string };

@Injectable()
export class VehicleTransferService {
    constructor(
        @Inject(VehicleHandovers) private readonly handovers: VehicleHandovers,
        @Inject(VehiclesService) private readonly vehicleRecords: VehiclesService,
        @Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService,
        @Inject(DocumentsService) private readonly documents: DocumentsService,
        @Inject(OrganisationsService) private readonly organisations: OrganisationsService,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    // ---- the transfer out (DVC-14) ----

    /**
     * The vehicle is on the register and handled by the office the case is filed in. For an office of the region: the office it goes
     * to is another active office that takes vehicles in (DVC-15). For another region (`destination: outside`, ADR-0058): the body
     * and the region it goes to are named, and the office can number the document. No other open request claims the vehicle, and no
     * release of it stands. The encumbrance check (`vehicles.checkEncumbrances:zone-transfer-out`) is named beside this effect.
     */
    async checkOut(tx: Tx, place: CasePlace, input: TransferOutInput, facts: Facts = {}) {
        const outside = input.destination === 'outside';
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicle));
        if (!vehicle || vehicle.status !== 'active')
            return refuse('vehicle', 'not_active', 'competency.rule.transferOutNotActive');
        if (vehicle.handlingUnitId !== place.handlingUnitId)
            return refuse('vehicle', 'other_office', 'competency.rule.transferOutOtherOffice');
        let seen: { openPeriodId: string; vinKey: string };
        let destination: { name: string; region: string } | undefined;
        if (outside) {
            const name = text(input.destinationName?.trim());
            const region = text(input.destinationRegion?.trim());
            const refusals: Refusal[] = [];
            if (!name)
                refusals.push({
                    path: 'destinationName',
                    code: 'required',
                    key: 'competency.rule.transferOutDestinationName'
                });
            if (!region)
                refusals.push({
                    path: 'destinationRegion',
                    code: 'required',
                    key: 'competency.rule.transferOutDestinationRegion'
                });
            if (refusals.length > 0 || !name || !region) return refuseAll(refusals);
            destination = { name, region };
            // the number comes later and is never made up on the spot: an office with no series is told now, not after the fee
            await requireCounter(tx, VEHICLE_TRANSFER_DOCUMENT_COUNTER, place.handlingUnitId);
            seen = await this.handovers.checkOutside(tx, place.ctx, vehicle.id);
        } else {
            if (!input.toOffice) return refuse('toOffice', 'required', 'competency.rule.transferOutNoOffice');
            if (input.toOffice === place.handlingUnitId)
                return refuse('toOffice', 'same_office', 'competency.rule.transferOutSameOffice');
            try {
                seen = await this.handovers.check(tx, place.ctx, vehicle.id, input.toOffice, TRANSFER_IN_SERVICE);
            } catch (error) {
                if (error instanceof AppError && error.detailKey === 'vehicles.errors.handover_not_offered')
                    return refuse('toOffice', 'not_offered', 'competency.rule.transferOutNotOffered');
                throw error;
            }
            // the covering letter of an office of the region is the setting's; its number comes from the same counter
            if (await this.coveringLetterWanted(tx, place.handlingUnitId))
                await requireCounter(tx, VEHICLE_TRANSFER_DOCUMENT_COUNTER, place.handlingUnitId);
        }
        // the owners the filing saw: a vehicle that changed hands since is a new request's
        const saw = text(factObject(facts, 'transferOut')?.ownershipId);
        if (saw && factObject(facts, 'transferOut')?.vehicleId === vehicle.id && saw !== seen.openPeriodId)
            return refuse('vehicle', 'owners_changed', 'competency.rule.transferOutOwnersChanged');
        await lockVehicleClaim(tx, vehicle.id);
        if (await claimedElsewhere(tx, place.caseId, { vehicleId: vehicle.id, vinKey: seen.vinKey }))
            return notEligible('competency.rule.transferOutInOpenCase');
        return {
            // the vehicle's id here is what the register's open-case lookup claims it by (migration 0086)
            transferOut: destination
                ? { vehicleId: vehicle.id, outside: true, toUnitId: null, destination, ownershipId: seen.openPeriodId }
                : {
                      vehicleId: vehicle.id,
                      outside: false,
                      toUnitId: input.toOffice,
                      ownershipId: seen.openPeriodId
                  }
        };
    }

    /**
     * The giving step of the transfer out: the vehicle is released to the office named, for the days the setting gives. When the
     * setting asks for it, the receiving office is sent a covering letter.
     */
    async release(tx: Tx, at: CasePlace, facts: Facts, caseNumber = 0) {
        const place = await actForHandlingOffice(tx, at);
        const out = factObject(facts, 'transferOut');
        const vehicleId = text(out?.vehicleId);
        const toUnitId = text(out?.toUnitId);
        const ownershipId = text(out?.ownershipId);
        if (!vehicleId || !toUnitId || !ownershipId) return notEligible('competency.rule.transferOutNotActive');
        const on = addisDay();
        const handover = await this.handovers.release(tx, place.ctx, {
            vehicleId,
            toUnitId,
            caseId: place.caseId,
            ownershipId,
            on,
            validUntil: daysAfter(on, await this.validDays(tx, place.handlingUnitId))
        });
        const result = {
            handover: { id: handover.id, validUntil: handover.validUntil, toUnitId: handover.toUnitId }
        };
        if (!(await this.coveringLetterWanted(tx, place.handlingUnitId))) return result;
        const [office] = [...(await unitRefs(tx, [toUnitId])).values()];
        const letter = await this.issueCoveringLetter(tx, place, handover, {
            vehicleId,
            caseNumber,
            addressee: office?.name,
            documentNumber: null
        });
        return { ...result, documents: { [VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE]: letter.id } };
    }

    /**
     * The giving step of a transfer out of the region (ADR-0058): the vehicle reads transferred out and the owner is given the
     * vehicle data transfer document, valid for the days the setting gives, with a covering letter for the body that receives it.
     * Only the status changes: the owners, plate, libre and stock plate stay. Run again for the same case it returns the documents
     * it issued.
     */
    async releaseOut(tx: Tx, at: CasePlace, facts: Facts, answers: unknown, caseNumber: number) {
        const place = await actForHandlingOffice(tx, at);
        const out = factObject(facts, 'transferOut');
        const vehicleId = text(out?.vehicleId);
        const ownershipId = text(out?.ownershipId);
        const named = out ? factObject(out, 'destination') : undefined;
        const name = text(named?.name);
        const region = text(named?.region);
        if (out?.outside !== true || !vehicleId || !ownershipId || !name || !region)
            return notEligible('competency.rule.transferOutNotActive');
        const [made] = await tx.select().from(vehicleHandovers).where(eq(vehicleHandovers.caseId, place.caseId));
        if (made)
            return { handover: this.handoverOf(made), documents: await this.documentsOf(tx, place.caseId, made.id) };

        const given = this.parseDocumentEntry(answers);
        const on = addisDay();
        const validDays = await this.validDays(tx, place.handlingUnitId);
        const validUntil = daysAfter(on, validDays);
        const handover = await this.handovers.releaseOutside(tx, place.ctx, {
            vehicleId,
            caseId: place.caseId,
            ownershipId,
            on,
            validUntil,
            destination: { name, region }
        });
        const language = currentContext()?.language === 'en' ? 'en' : 'am';
        const vehicle = await this.vehicleRecords.get(tx, vehicleId);
        const holders = vehicle.ownerships.find((o) => o.id === ownershipId)?.holders ?? [];
        const addresses = await this.registration.ownerAddresses(tx, holders, language);
        const owners = holders.map((h) => ({
            name: h.name[language] || h.name.am,
            address: addresses.get(h.id) ?? null
        }));
        const registerPlace = await this.regionName(tx, place.regionId, language);
        const number = (await nextNumber(tx, VEHICLE_TRANSFER_DOCUMENT_COUNTER, place.handlingUnitId)).number;
        const document = await this.documents.reissue(tx, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            templateKey: VEHICLE_TRANSFER_DOCUMENT_TEMPLATE,
            language,
            number,
            caseId: place.caseId,
            subject: { table: 'workflow.cases', id: place.caseId },
            data: {
                number,
                issuedOn: on,
                validUntil,
                validDays,
                caseNumber,
                destination: { name, region },
                owners,
                vehicle: {
                    plate: vehicle.currentPlate?.text ?? '',
                    chassisNumber: vehicle.chassisNumber,
                    engineNumber: vehicle.engineNumber,
                    make: vehicle.make,
                    model: vehicle.model,
                    modelYear: vehicle.modelYear,
                    category: { am: vehicle.category.name.am ?? '', en: vehicle.category.name.en ?? '' },
                    use: words(`vehicles.use.${vehicle.use}`)
                },
                // the register's plates, the current one first, then the earlier ones the owner brought
                plates: [
                    ...[...vehicle.plates]
                        .sort(
                            (a, b) =>
                                Number(b.until === null) - Number(a.until === null) || b.since.localeCompare(a.since)
                        )
                        .map((p) => ({
                            plate: p.text,
                            since: p.since,
                            until: p.until,
                            year: null,
                            place: p.legacyRegionCode ?? registerPlace
                        })),
                    ...given.earlierPlates.map((p) => ({
                        plate: p.plate,
                        since: null,
                        until: null,
                        year: p.year,
                        place: p.place
                    }))
                ],
                customsDeclarationNumber: given.customsDeclarationNumber ?? null,
                taxReceiptNumber: given.taxReceiptNumber ?? null,
                purchaseValueSantim:
                    given.purchaseValueBirr === undefined ? null : santim('purchaseValueBirr', given.purchaseValueBirr),
                excisePaidSantim:
                    given.excisePaidBirr === undefined ? null : santim('excisePaidBirr', given.excisePaidBirr),
                bolo: await this.boloOf(tx, vehicleId),
                holds: await this.holdsOf(tx, vehicleId, language),
                remarks: given.remarks ?? null,
                // the signatures are the office's own, on paper
                preparedBy: null,
                approvedBy: null
            }
        });
        const letter = await this.issueCoveringLetter(tx, place, handover, {
            vehicleId,
            caseNumber,
            addressee: { am: name, en: name },
            documentNumber: number
        });
        return {
            handover: this.handoverOf(handover),
            documents: {
                [VEHICLE_TRANSFER_DOCUMENT_TEMPLATE]: document.id,
                [VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE]: letter.id
            }
        };
    }

    // ---- the transfer in (DVC-15) ----

    /**
     * The vehicle is released to the office the case is filed in, and its release still stands; no other open request claims it.
     * Whether the vehicle is inspected again is the setting's at the filing, kept in the case's facts: changing it later does not
     * change a running case.
     */
    async checkIn(tx: Tx, place: CasePlace, input: TransferInInput, facts: Facts = {}) {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicle));
        if (!vehicle || vehicle.status !== 'active')
            return refuse('vehicle', 'not_active', 'competency.rule.transferOutNotActive');
        if (vehicle.handlingUnitId === place.handlingUnitId)
            return refuse('vehicle', 'handled_here', 'competency.rule.transferInHandledHere');
        const standing = await this.handovers.standing(tx, vehicle.id);
        if (!standing || standing.toUnitId !== place.handlingUnitId)
            return refuse('vehicle', 'not_released', 'competency.rule.transferInNoRelease');
        if (standing.validUntil < addisDay())
            return refuse('vehicle', 'release_lapsed', 'competency.rule.transferInExpired');
        await lockVehicleClaim(tx, vehicle.id);
        if (await claimedElsewhere(tx, place.caseId, { vehicleId: vehicle.id, vinKey: vehicle.vinKey }))
            return notEligible('competency.rule.transferInInOpenCase');
        const earlier = factObject(facts, 'transferIn')?.reinspect;
        const reinspect =
            typeof earlier === 'boolean'
                ? earlier
                : (await this.settings.value<unknown>(tx, place.handlingUnitId, VEHICLE_TRANSFER_REINSPECT_SETTING)) ===
                  true;
        return { transferIn: { vehicleId: vehicle.id, handoverId: standing.id, reinspect } };
    }

    /** The receiving office's inspection, when the setting asks for one: the vehicle is the one its record says. */
    async recordInspection(tx: Tx, at: CasePlace, answers: unknown) {
        await actForHandlingOffice(tx, at);
        const parsed = transferInspectionEntrySchema.safeParse(answers ?? {});
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({
                    path: i.path.join('.'),
                    code: 'invalid',
                    message: i.message
                }))
            });
        if (!parsed.data.inspectionMatches)
            return refuse('inspectionMatches', 'not_matching', 'competency.rule.transferInspectionNotMatching');
        return { transferInspection: { on: addisDay(), note: parsed.data.inspectionNote ?? null } };
    }

    /**
     * The giving step of the transfer in: the register's command moves the vehicle and its live records to this office, and each row
     * it wrote is audited. Run again for the same case it moves nothing more.
     */
    async receive(tx: Tx, at: CasePlace, facts: Facts) {
        const place = await actForHandlingOffice(tx, at);
        const done = await this.handovers.receivedBy(tx, place.caseId);
        if (done) return { received: { handoverId: done.id, on: done.receivedOn } };
        const handoverId = text(factObject(facts, 'transferIn')?.handoverId);
        if (!handoverId) return refuse('vehicle', 'not_released', 'competency.rule.transferInNoRelease');
        await this.handovers.accept(tx, handoverId, place.caseId);
        return { received: { handoverId, on: addisDay() } };
    }

    private handoverOf(row: typeof vehicleHandovers.$inferSelect) {
        return { id: row.id, validUntil: row.validUntil, toUnitId: row.toUnitId };
    }

    /** An entry the step's form let through that its schema or a range does not: a 422 with the fields, never a 500. */
    private parseDocumentEntry(answers: unknown) {
        const parsed = transferDocumentEntrySchema.safeParse(answers ?? {});
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({
                    path: i.path.join('.'),
                    code: 'invalid',
                    message: i.message
                }))
            });
        const refusals: Refusal[] = [];
        parsed.data.earlierPlates.forEach((p, i) => {
            if (!Number.isInteger(p.year) || p.year < 1900 || p.year > 2100)
                refusals.push({
                    path: `earlierPlates.${i}.year`,
                    code: 'out_of_range',
                    key: 'competency.rule.transferDocumentPlateYear'
                });
        });
        if (refusals.length > 0) return refuseAll(refusals);
        return parsed.data;
    }

    private async coveringLetterWanted(tx: Tx, unitId: string): Promise<boolean> {
        return (await this.settings.value<unknown>(tx, unitId, VEHICLE_TRANSFER_COVERING_LETTER_SETTING)) === true;
    }

    /**
     * The covering letter for the office that receives the vehicle, numbered from the transfer document's counter. Its subject is
     * the release, so it stands once for it.
     */
    private async issueCoveringLetter(
        tx: Tx,
        place: CasePlace,
        handover: typeof vehicleHandovers.$inferSelect,
        given: {
            vehicleId: string;
            caseNumber: number;
            addressee: { am?: string; en?: string } | undefined;
            documentNumber: string | null;
        }
    ) {
        const [standing] = await tx
            .select({ document: issuedDocuments })
            .from(issuedDocuments)
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(
                and(
                    eq(documentTemplates.key, VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE),
                    eq(issuedDocuments.subjectId, handover.id),
                    isNull(issuedDocuments.supersededBy)
                )
            );
        if (standing) return standing.document;
        const language = currentContext()?.language === 'en' ? 'en' : 'am';
        const vehicle = await this.vehicleRecords.get(tx, given.vehicleId);
        const holders = vehicle.ownerships.find((o) => o.id === handover.ownershipId)?.holders ?? [];
        const number = (await nextNumber(tx, VEHICLE_TRANSFER_DOCUMENT_COUNTER, place.handlingUnitId)).number;
        return this.documents.reissue(tx, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            templateKey: VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE,
            language,
            number,
            caseId: place.caseId,
            subject: { table: 'vehicles.vehicle_handovers', id: handover.id },
            data: {
                number,
                issuedOn: handover.releasedOn,
                validUntil: handover.validUntil,
                caseNumber: given.caseNumber,
                addressee: given.addressee?.[language] || given.addressee?.am || '',
                documentNumber: given.documentNumber,
                vehicle: {
                    plate: vehicle.currentPlate?.text ?? '',
                    chassisNumber: vehicle.chassisNumber,
                    make: vehicle.make,
                    model: vehicle.model
                },
                owners: holders.map((h) => ({ name: h.name[language] || h.name.am }))
            }
        });
    }

    /** The documents this case issued for a release, by template (a step run again). */
    private async documentsOf(tx: Tx, caseId: string, handoverId: string): Promise<Record<string, string>> {
        const rows = await tx
            .select({ key: documentTemplates.key, id: issuedDocuments.id })
            .from(issuedDocuments)
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(
                and(
                    inArray(documentTemplates.key, [
                        VEHICLE_TRANSFER_DOCUMENT_TEMPLATE,
                        VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE
                    ]),
                    inArray(issuedDocuments.subjectId, [caseId, handoverId]),
                    isNull(issuedDocuments.supersededBy)
                )
            );
        return Object.fromEntries(rows.map((r) => [r.key, r.id]));
    }

    /** The region's name, for a plate the register itself issued (a legacy plate names its own region code). */
    private async regionName(tx: Tx, regionId: string, language: 'am' | 'en'): Promise<string | null> {
        const [root] = await tx
            .select({ name: orgUnits.name })
            .from(orgUnits)
            .where(and(eq(orgUnits.regionId, regionId), isNull(orgUnits.parentId)));
        return root ? root.name[language] || root.name.am || null : null;
    }

    /** The latest bolo of the vehicle that is not void: its sticker (a temporary one has none) and its last day. */
    private async boloOf(tx: Tx, vehicleId: string) {
        const [bolo] = await tx
            .select()
            .from(bolos)
            .where(and(eq(bolos.vehicleId, vehicleId), inArray(bolos.status, ['valid', 'temporary'])))
            .orderBy(desc(bolos.validUntil))
            .limit(1);
        if (!bolo) return null;
        // a sticker given after a temporary bolo keeps the temporary day on its row: the status says which day stands
        const temporary = bolo.status === 'temporary';
        return {
            serial: bolo.stickerKey,
            validUntil: temporary ? (bolo.temporaryUntil ?? bolo.validUntil) : bolo.validUntil,
            temporary
        };
    }

    /** The holds the vehicle still carries. Normally none: the hold check ran on the same transition. */
    private async holdsOf(tx: Tx, vehicleId: string, language: 'am' | 'en') {
        const rows = await tx
            .select()
            .from(vehicleEncumbrances)
            .where(and(eq(vehicleEncumbrances.vehicleId, vehicleId), ne(vehicleEncumbrances.status, 'released')));
        const holders = new Map(
            (
                await this.organisations.summaries(
                    tx,
                    rows.map((r) => r.holderOrganisationId)
                )
            ).map((o) => [o.id, o])
        );
        return rows.map((r) => {
            const holder = holders.get(r.holderOrganisationId);
            return {
                kind: words(`vehicles.encumbrance.kind.${r.kind}`),
                holder: (holder ? holder.name[language] || holder.name.am : '') || r.letterReference,
                letterReference: r.letterReference,
                letterDate: r.letterDate,
                amountSantim: r.amountSantim === null ? null : r.amountSantim.toString()
            };
        });
    }

    /** A number of days the settings give, or the default when the setting is not a whole number in range. */

    private async validDays(tx: Tx, unitId: string): Promise<number> {
        const value = await this.settings.value<unknown>(tx, unitId, VEHICLE_TRANSFER_VALID_DAYS_SETTING);
        const days = z.number().int().min(1).max(60).safeParse(value);
        return days.success ? days.data : DEFAULT_VEHICLE_TRANSFER_DAYS;
    }
}
