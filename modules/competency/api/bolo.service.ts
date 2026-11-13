/**
 * The annual technical inspection, DVC-02 (task 1.3a): what a request must meet, the inspection on the bureau's checklist, and the
 * bolo a passed inspection makes, carried on its sticker from the office's stationery or, while the office has none of its kind
 * and year, on a temporary bolo. The checklist's outcome is the server's (task 1.13a): a pass with a failed item is refused here
 * too. The bolo is a registry record of the vehicle (class R): any office of the region reads it. A vehicle that fails goes to a
 * garage and is inspected again on the same case (task 1.3b); each inspection is a row of the inspection register. Once the
 * sticker is given, the owners' reminder is scheduled for a set number of days before the bolo's last day.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import { insertAudited, type Tx, updateAudited } from '@itrms/kernel/db';
import { ConflictError, ValidationError } from '@itrms/kernel/errors';
import { nextNumber } from '@itrms/kernel/numbering';
import { emit } from '@itrms/kernel/outbox';
import { SettingsService } from '@itrms/kernel/settings';
import { DocumentsService, documentTemplates, issuedDocuments, revokeDocument } from '@itrms/documents/api';
import { StationeryStock } from '@itrms/fees/api';
import { organisations } from '@itrms/parties/api';
import { vehicles, VehiclesService } from '@itrms/vehicles/api';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import {
    addisDay,
    BOLO_REMINDER_DAYS_SETTING,
    BOLO_TEMPLATE,
    DEFAULT_BOLO_REMINDER_DAYS,
    DEFAULT_TEMPORARY_BOLO_DAYS,
    GARAGE_KIND,
    inspectionEntrySchema,
    insuranceSchema,
    repairEntrySchema,
    ROAD_FUND_USES,
    TEMPORARY_BOLO_COUNTER,
    TEMPORARY_BOLO_DAYS_SETTING,
    TEMPORARY_BOLO_TEMPLATE
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { boloValidity, daysAfter, reminderDue } from './bolo-validity';
import { boloInspections, bolos, type FailedItem } from './competency.table';
import { actForHandlingOffice } from './handling-office';
import type { CasePlace } from './licences.service';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;
type Bolo = typeof bolos.$inferSelect;
type BoloInspection = typeof boloInspections.$inferSelect;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

const refuse = (path: string, code: string, key: Words): never => {
    throw new ValidationError('validation_failed', { errors: [{ path, code, message: say(key) }] });
};

/** The request's answers an effect reads, by contract path (see bolo.effects.ts). */
export type BoloInput = {
    vehicle: string;
    /** its use, seats and load, as the fee was worked out from them: the register's must be the same */
    use: string;
    seats?: number;
    loadTonnes?: number;
    insuranceCertificate: string;
    insurer: string;
    insuredFrom: string;
    insuredUntil: string;
    roadFundReceipt?: unknown[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const factOf = (facts: Facts, key: string): Record<string, unknown> | undefined => {
    const v = facts[key];
    return isRecord(v) ? v : undefined;
};

const alreadyHeld = () =>
    new ValidationError('not_eligible', {
        detail: say('competency.rule.boloAlreadyHeld'),
        detailKey: 'competency.rule.boloAlreadyHeld'
    });

/** Two cases giving one vehicle a bolo of the same year at the same moment: the database's index refuses the second. */
async function heldOnce<T>(write: () => Promise<T>): Promise<T> {
    try {
        return await write();
    } catch (error) {
        for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
            const { code, constraint } = e as { code?: string; constraint?: string };
            if (code === '23505' && constraint === 'bolos_vehicle_year_uq') throw alreadyHeld();
        }
        throw error;
    }
}

const missingFact = (key: string) =>
    new ConflictError('contract_unmet', { detailKey: 'competency.errors.registration_missing_fact', params: { key } });

/** The repair the garage step recorded, and the inspection it followed. */
const repairOf = (
    facts: Facts
): { garageId: string; repairedOn: string; note: string | null; afterAttempt: number } | undefined => {
    const r = factOf(facts, 'repair');
    if (typeof r?.garageId !== 'string' || typeof r.repairedOn !== 'string' || typeof r.afterAttempt !== 'number')
        return undefined;
    return {
        garageId: r.garageId,
        repairedOn: r.repairedOn,
        note: typeof r.note === 'string' ? r.note : null,
        afterAttempt: r.afterAttempt
    };
};

/** The items the checklist's outcome failed, each with the inspector's remark, for the register. */
function failedItemsOf(
    checklist: Record<string, unknown> | undefined,
    outcome: Record<string, unknown> | undefined
): FailedItem[] {
    const items = checklist && isRecord(checklist.items) ? checklist.items : {};
    const keys = Array.isArray(outcome?.failed) ? outcome.failed.filter((k): k is string => typeof k === 'string') : [];
    return keys.map((key) => {
        const answer = items[key];
        const remark = isRecord(answer) && typeof answer.remark === 'string' ? answer.remark : undefined;
        return remark ? { key, remark } : { key };
    });
}

const words = (key: string): { am: string; en: string } => ({
    am: (vehiclesAm as Record<string, string>)[key] ?? key,
    en: (vehiclesEn as Record<string, string>)[key] ?? key
});

@Injectable()
export class BoloService {
    constructor(
        @Inject(VehiclesService) private readonly vehicles: VehiclesService,
        @Inject(DocumentsService) private readonly documents: DocumentsService,
        @Inject(StationeryStock) private readonly stationery: StationeryStock,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    // ---- filing ----

    /**
     * What makes a bolo request acceptable, checked on the server: the vehicle is on the register and active; the third-party
     * insurance policy covers today (Proclamation 799/2013: an expired policy is refused); a vehicle of a use that pays the Road
     * Fund (plate codes 1 and 3) brings its receipt; and it has no bolo of this fiscal year already. Nothing is written.
     */
    async check(tx: Tx, place: CasePlace, input: BoloInput) {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicle));
        if (!vehicle || vehicle.status !== 'active')
            return refuse('vehicle', 'not_active', 'competency.rule.boloNotActive');
        if (input.use !== vehicle.use) return refuse('use', 'mismatch', 'competency.rule.exchangeUse');
        // the fee is worked out from the seats (a bus) and the load (a truck): they are the register's, never fewer
        if (vehicle.use === 'public_transport' && (vehicle.seats === null || input.seats !== vehicle.seats))
            return refuse('seats', 'mismatch', 'competency.rule.boloSeats');
        if (
            vehicle.use === 'commercial' &&
            (vehicle.loadCapacityKg === null ||
                typeof input.loadTonnes !== 'number' ||
                Math.abs(input.loadTonnes * 1000 - vehicle.loadCapacityKg) >= 500)
        )
            return refuse('loadTonnes', 'mismatch', 'competency.rule.boloLoad');
        const insurance = insuranceSchema.safeParse({
            certificate: input.insuranceCertificate,
            insurer: input.insurer,
            from: input.insuredFrom,
            until: input.insuredUntil
        });
        if (!insurance.success) return refuse('insuranceCertificate', 'invalid', 'competency.rule.boloInsurance');
        const today = addisDay();
        if (insurance.data.until < insurance.data.from)
            return refuse('insuredUntil', 'before_start', 'competency.rule.boloInsurancePeriod');
        if (insurance.data.until < today || insurance.data.from > today)
            return refuse('insuredUntil', 'expired', 'competency.rule.boloInsuranceExpired');
        if (
            ROAD_FUND_USES.includes(vehicle.use) &&
            !(Array.isArray(input.roadFundReceipt) && input.roadFundReceipt.length)
        )
            return refuse('roadFundReceipt', 'required', 'competency.rule.boloRoadFund');
        await this.notHeld(tx, vehicle.id, boloValidity(today).fiscalYear, place.caseId);
        return {
            vehicle: { id: vehicle.id },
            bolo: { vehicleId: vehicle.id, use: vehicle.use, insurance: insurance.data }
        };
    }

    // ---- the inspection ----

    /**
     * The inspector's step: the sheet's serial, the day, and the checklist, whose outcome the server worked out. `pass` makes the
     * bolo and is refused unless the checklist passed (a failed item blocks it); `fail` records the failed items and is refused
     * for a checklist that passed. Each inspection is a row of the register, the attempt after a repair with its garage. A
     * re-inspection stays in the fiscal year of the first: the case's fee and checks were for that year's bolo.
     */
    async inspect(tx: Tx, at: CasePlace, facts: Facts, input: unknown, result: 'pass' | 'fail') {
        const place = await actForHandlingOffice(tx, at);
        const entry = inspectionEntrySchema.safeParse(input);
        if (!entry.success)
            throw new ValidationError('validation_failed', {
                errors: entry.error.issues.map((i) => ({ path: i.path.join('.'), code: 'invalid', message: i.message }))
            });
        const today = addisDay();
        const inspectedOn = entry.data.inspectedOn ?? today;
        if (inspectedOn > today) return refuse('inspectedOn', 'future', 'competency.rule.boloInspectedLater');
        // inspected in this fiscal year: an older day would make a bolo of a past year, already over
        if (boloValidity(inspectedOn).fiscalYear !== boloValidity(today).fiscalYear)
            return refuse('inspectedOn', 'past_year', 'competency.rule.boloInspectedEarlier');
        // after a failed inspection, this one follows the repair the garage step recorded for it, on or after its day
        const previous = await this.lastInspection(tx, place.caseId);
        const repair = previous ? repairOf(facts) : undefined;
        if (previous && repair?.afterAttempt !== previous.attempt) throw missingFact('repair');
        if (previous && boloValidity(previous.inspectedOn).fiscalYear !== boloValidity(inspectedOn).fiscalYear)
            return refuse('inspectedOn', 'past_year', 'competency.rule.boloRepairPastYear');
        if (previous && inspectedOn < (repair?.repairedOn ?? previous.inspectedOn))
            return refuse('inspectedOn', 'before_repair', 'competency.rule.boloInspectedBeforeRepair');
        // the checklist as the step's answers were filed: its outcome is the one the server worked out (task 1.13a)
        const checklist = isRecord(input) && isRecord(input.inspection) ? input.inspection : undefined;
        const outcome = checklist && isRecord(checklist.outcome) ? checklist.outcome : undefined;
        const passed = outcome?.passed;
        if (result === 'pass' && passed !== true)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloNotPassed' });
        if (result === 'fail' && passed !== false)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloNotFailed' });
        const asked = factOf(facts, 'bolo');
        if (typeof asked?.vehicleId !== 'string') throw missingFact('bolo');
        const vehicleId = asked.vehicleId;
        const failedItems = failedItemsOf(checklist, outcome);
        const attempt = (previous?.attempt ?? 0) + 1;
        const inspection = {
            attempt,
            checklistSerial: entry.data.checklistSerial,
            inspectedOn,
            passed,
            failed: failedItems.map((i) => i.key),
            total: outcome?.total,
            max: outcome?.max
        };
        const [made] = await tx
            .select()
            .from(bolos)
            .where(and(eq(bolos.caseId, place.caseId), ne(bolos.status, 'void')));
        // defensive: a case whose bolo exists never comes back to its inspection, and would not write the register twice
        if (!made)
            await insertAudited(tx, boloInspections, {
                regionId: place.regionId,
                handlingUnitId: place.handlingUnitId,
                caseId: place.caseId,
                vehicleId,
                attempt,
                checklistSerial: entry.data.checklistSerial,
                inspectedOn,
                passed: result === 'pass',
                failedItems,
                garageId: repair?.garageId ?? null,
                repairedOn: repair?.repairedOn ?? null,
                repairNote: repair?.note ?? null
            });
        if (result === 'fail') return { inspection };
        const insurance = insuranceSchema.safeParse(asked.insurance);
        if (typeof asked.use !== 'string' || !insurance.success) throw missingFact('bolo');
        const use = asked.use;
        // a re-inspection weeks after the filing: the policy must still cover the day the bolo is given on
        if (!made && insurance.data.until < today)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloInsuranceExpired' });
        const validity = boloValidity(inspectedOn);
        if (!made) {
            const [vehicle] = await tx
                .select({ status: vehicles.status })
                .from(vehicles)
                .where(eq(vehicles.id, vehicleId));
            if (vehicle?.status !== 'active')
                throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloNotActive' });
            // another case may have given it this year's bolo since this one was filed (the index is the last word)
            await this.notHeld(tx, vehicleId, validity.fiscalYear, place.caseId);
        }
        const bolo =
            made ??
            (await heldOnce(() =>
                insertAudited(tx, bolos, {
                    regionId: place.regionId,
                    handlingUnitId: place.handlingUnitId,
                    vehicleId,
                    caseId: place.caseId,
                    use,
                    checklistSerial: entry.data.checklistSerial,
                    inspectedOn,
                    fiscalYear: validity.fiscalYear,
                    validUntil: validity.validUntil,
                    insuranceCertificate: insurance.data.certificate,
                    insurer: insurance.data.insurer,
                    insuredFrom: insurance.data.from,
                    insuredUntil: insurance.data.until
                })
            ));
        return {
            inspection,
            bolo: { ...asked, id: bolo.id, fiscalYear: bolo.fiscalYear, validUntil: bolo.validUntil }
        };
    }

    /**
     * The garage step after a failed inspection: the garage that repaired the vehicle (an organisation of that kind in the
     * register), the day it came back (today when not given, never before the failure) and what was done. Nothing is written
     * here: the next inspection carries it into the register.
     */
    async repair(tx: Tx, at: CasePlace, input: unknown) {
        const place = await actForHandlingOffice(tx, at);
        const entry = repairEntrySchema.safeParse(input);
        if (!entry.success)
            throw new ValidationError('validation_failed', {
                errors: entry.error.issues.map((i) => ({ path: i.path.join('.'), code: 'invalid', message: i.message }))
            });
        const last = await this.lastInspection(tx, place.caseId);
        if (!last || last.passed)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloNothingToRepair' });
        const [garage] = await tx
            .select({ kind: organisations.kind })
            .from(organisations)
            .where(eq(organisations.id, entry.data.garage));
        if (garage?.kind !== GARAGE_KIND) return refuse('garage', 'not_a_garage', 'competency.rule.boloNotAGarage');
        const today = addisDay();
        const repairedOn = entry.data.repairedOn ?? today;
        if (repairedOn > today) return refuse('repairedOn', 'future', 'competency.rule.boloRepairLater');
        if (repairedOn < last.inspectedOn)
            return refuse('repairedOn', 'before_failure', 'competency.rule.boloRepairBeforeFailure');
        // the fiscal year ended since the failure: this case's bolo can no longer be given, the request is closed as failed
        if (boloValidity(today).fiscalYear !== boloValidity(last.inspectedOn).fiscalYear)
            return refuse('repairedOn', 'past_year', 'competency.rule.boloRepairPastYear');
        return {
            repair: {
                garageId: entry.data.garage,
                repairedOn,
                note: entry.data.repairNote || null,
                afterAttempt: last.attempt
            }
        };
    }

    /** A case's inspections in the register, the latest first. */
    async inspections(tx: Tx, caseId: string): Promise<BoloInspection[]> {
        return tx
            .select()
            .from(boloInspections)
            .where(eq(boloInspections.caseId, caseId))
            .orderBy(desc(boloInspections.attempt));
    }

    private async lastInspection(tx: Tx, caseId: string): Promise<BoloInspection | undefined> {
        const [last] = await tx
            .select()
            .from(boloInspections)
            .where(eq(boloInspections.caseId, caseId))
            .orderBy(desc(boloInspections.attempt))
            .limit(1);
        return last;
    }

    // ---- the sticker, or a temporary bolo ----

    /**
     * The sticker of the vehicle's use and the bolo's fiscal year, from the office's stationery: the one the officer names, or the
     * next one. With none in stock the step is refused and the case waits until stickers come (a temporary bolo stands
     * meanwhile). The bolo document is issued with the sticker's serial as its number. Run again it returns the sticker it took.
     */
    async issueSticker(tx: Tx, at: CasePlace, facts: Facts, answers: unknown) {
        const place = await actForHandlingOffice(tx, at);
        const bolo = await this.boloOf(tx, facts);
        const named =
            isRecord(answers) && typeof answers.stickerSerial === 'string' ? answers.stickerSerial.trim() : '';
        const item = await this.stationery.use(tx, place.ctx, {
            kind: 'bolo_sticker',
            ...(named ? { key: named } : {}),
            variant: bolo.use,
            validEfy: bolo.fiscalYear,
            usedFor: { table: 'competency.bolos', id: bolo.id },
            caseId: place.caseId
        });
        let now = bolo;
        if (bolo.status !== 'valid') {
            now = await updateAudited(tx, bolos, bolo.id, bolo.rowVersion, {
                status: 'valid',
                stickerKey: item.itemKey
            });
            // the sticker replaces the temporary bolo: its QR no longer says it stands
            await this.endTemporary(tx, bolo.id, 'bolo_sticker_given');
            await this.scheduleReminder(tx, place, now);
        }
        const issued = await this.document(tx, place, now, BOLO_TEMPLATE, item.itemKey);
        const known = factOf(facts, 'documents') ?? {};
        return {
            bolo: { ...factOf(facts, 'bolo'), id: now.id, sticker: item.itemKey, status: now.status },
            documents: { ...known, [BOLO_TEMPLATE]: issued.id }
        };
    }

    /**
     * A temporary bolo while the office has no sticker of the vehicle's kind and year (refused while it has one): numbered from
     * the office's counter, it stands for the office's `competency.bolo_temporary_days` (30 by default), never past the bolo's own
     * last day. Issued once: run again it returns the same one; once the sticker is given it is refused.
     */
    async issueTemporary(tx: Tx, at: CasePlace, facts: Facts) {
        const place = await actForHandlingOffice(tx, at);
        const bolo = await this.boloOf(tx, facts);
        if (bolo.status === 'valid')
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloStickerGiven' });
        if (
            bolo.status !== 'temporary' &&
            (await this.stationery.inStock(tx, place.ctx, {
                kind: 'bolo_sticker',
                variant: bolo.use,
                validEfy: bolo.fiscalYear
            }))
        )
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloStickersInStock' });
        const days = await this.days(
            tx,
            place.handlingUnitId,
            TEMPORARY_BOLO_DAYS_SETTING,
            DEFAULT_TEMPORARY_BOLO_DAYS
        );
        const until = [daysAfter(addisDay(), days), bolo.validUntil].sort()[0] ?? bolo.validUntil;
        const now =
            bolo.status === 'temporary'
                ? bolo
                : await updateAudited(tx, bolos, bolo.id, bolo.rowVersion, {
                      status: 'temporary',
                      temporaryUntil: until
                  });
        const known = factOf(facts, 'documents') ?? {};
        const standing = factOf(facts, 'temporaryBolo');
        const number =
            typeof standing?.number === 'string'
                ? standing.number
                : (await nextNumber(tx, TEMPORARY_BOLO_COUNTER, place.handlingUnitId)).number;
        const issued = await this.document(tx, place, now, TEMPORARY_BOLO_TEMPLATE, number);
        return {
            bolo: { ...factOf(facts, 'bolo'), id: now.id, status: now.status, temporaryUntil: now.temporaryUntil },
            temporaryBolo: { number, until: now.temporaryUntil },
            documents: { ...known, [TEMPORARY_BOLO_TEMPLATE]: issued.id }
        };
    }

    /**
     * A case rejected after its pass (waiting for a sticker no office can give, or on its temporary bolo): its bolo is void, so it
     * no longer counts as this year's and the vehicle can be filed again. A bolo carried on its sticker is never voided here.
     */
    async void(tx: Tx, at: CasePlace) {
        const place = await actForHandlingOffice(tx, at);
        const [bolo] = await tx
            .select()
            .from(bolos)
            .where(and(eq(bolos.caseId, place.caseId), ne(bolos.status, 'void')));
        if (!bolo || bolo.status === 'valid') return {};
        const voided = await updateAudited(tx, bolos, bolo.id, bolo.rowVersion, {
            status: 'void',
            voidReason: 'the case was rejected before the sticker'
        });
        // a temporary bolo given on the case stops standing with it
        await this.endTemporary(tx, bolo.id, 'bolo_case_rejected');
        return { bolo: { id: voided.id, status: voided.status } };
    }

    /** The bolo's temporary document that stands, if any (a correction supersedes the first), revoked: its QR says so. */
    private async endTemporary(tx: Tx, boloId: string, reason: string) {
        const standing = await tx
            .select({ document: issuedDocuments })
            .from(issuedDocuments)
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(
                and(
                    eq(documentTemplates.key, TEMPORARY_BOLO_TEMPLATE),
                    eq(issuedDocuments.subjectId, boloId),
                    isNull(issuedDocuments.supersededBy),
                    isNull(issuedDocuments.revokedAt)
                )
            );
        for (const { document } of standing) await revokeDocument(tx, document, reason);
    }

    /**
     * The owners' reminder, due a set number of days (the office's `competency.bolo_reminder_days`) before the bolo's last day,
     * at 08:00 in Addis Ababa: the outbox holds the event until then. A bolo given inside that window has none: the counter
     * tells its owner the day.
     */
    private async scheduleReminder(tx: Tx, place: CasePlace, bolo: Bolo) {
        const days = await this.days(tx, place.handlingUnitId, BOLO_REMINDER_DAYS_SETTING, DEFAULT_BOLO_REMINDER_DAYS);
        const due = reminderDue(bolo.validUntil, days);
        if (due.getTime() <= Date.now()) return;
        await emit(
            tx,
            'bolo.expiring.v1',
            { boloId: bolo.id },
            { unitId: place.handlingUnitId, regionId: place.regionId, availableAt: due }
        );
    }

    /** A number of days the office's settings give, or its default when the setting is not a positive whole number. */
    private async days(tx: Tx, unitId: string, key: string, fallback: number): Promise<number> {
        const value = await this.settings.value<unknown>(tx, unitId, key);
        return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
    }

    /** Refused when the vehicle has a bolo of the fiscal year from another case (one not voided). */
    private async notHeld(tx: Tx, vehicleId: string, fiscalYear: number, caseId: string) {
        const [held] = await tx
            .select({ id: bolos.id })
            .from(bolos)
            .where(
                and(
                    eq(bolos.vehicleId, vehicleId),
                    eq(bolos.fiscalYear, fiscalYear),
                    ne(bolos.status, 'void'),
                    ne(bolos.caseId, caseId)
                )
            );
        if (held) throw alreadyHeld();
    }

    private async boloOf(tx: Tx, facts: Facts): Promise<Bolo> {
        const id = factOf(facts, 'bolo')?.id;
        if (typeof id !== 'string') throw missingFact('bolo');
        const [bolo] = await tx.select().from(bolos).where(eq(bolos.id, id));
        if (!bolo || bolo.status === 'void') throw missingFact('bolo');
        return bolo;
    }

    /** The bolo document (or the temporary one) as the bolo and the vehicle now stand. */
    private async document(tx: Tx, place: CasePlace, bolo: Bolo, templateKey: string, number: string) {
        const vehicle = await this.vehicles.get(tx, bolo.vehicleId);
        const language = currentContext()?.language === 'en' ? 'en' : 'am';
        return this.documents.reissue(tx, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            templateKey,
            language,
            number,
            caseId: place.caseId,
            subject: { table: 'competency.bolos', id: bolo.id },
            data: {
                number,
                plate: vehicle.currentPlate?.text ?? '',
                chassisNumber: vehicle.chassisNumber,
                make: vehicle.make,
                model: vehicle.model,
                category: { am: vehicle.category.name.am ?? '', en: vehicle.category.name.en ?? '' },
                use: words(`vehicles.use.${bolo.use}`),
                checklistSerial: bolo.checklistSerial,
                inspectedOn: bolo.inspectedOn,
                fiscalYear: bolo.fiscalYear,
                validUntil: bolo.validUntil,
                temporaryUntil: templateKey === TEMPORARY_BOLO_TEMPLATE ? bolo.temporaryUntil : null,
                insurance: {
                    certificate: bolo.insuranceCertificate,
                    insurer: bolo.insurer,
                    until: bolo.insuredUntil
                }
            }
        });
    }
}
