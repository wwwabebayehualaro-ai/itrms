/**
 * The annual technical inspection, DVC-02 (task 1.3a): what a request must meet, the inspection on the bureau's checklist, and the
 * bolo a passed inspection makes, carried on its sticker from the office's stationery or, while the office has none of its kind
 * and year, on a temporary bolo. The checklist's outcome is the server's (task 1.13a): a pass with a failed item is refused here
 * too. The bolo is a registry record of the vehicle (class R): any office of the region reads it.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import { insertAudited, type Tx, updateAudited } from '@itrms/kernel/db';
import { ConflictError, ValidationError } from '@itrms/kernel/errors';
import { nextNumber } from '@itrms/kernel/numbering';
import { DocumentsService } from '@itrms/documents/api';
import { StationeryStock } from '@itrms/fees/api';
import { vehicles, VehiclesService } from '@itrms/vehicles/api';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import {
    addisDay,
    BOLO_TEMPLATE,
    boloValidity,
    daysAfter,
    DEFAULT_TEMPORARY_BOLO_DAYS,
    inspectionEntrySchema,
    insuranceSchema,
    ROAD_FUND_USES,
    TEMPORARY_BOLO_COUNTER,
    TEMPORARY_BOLO_TEMPLATE
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { bolos } from './competency.table';
import { actForHandlingOffice } from './handling-office';
import type { CasePlace } from './licences.service';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;
type Bolo = typeof bolos.$inferSelect;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

const refuse = (path: string, code: string, key: Words): never => {
    throw new ValidationError('validation_failed', { errors: [{ path, code, message: say(key) }] });
};

/** The request's answers an effect reads, by contract path (see bolo.effects.ts). */
export type BoloInput = {
    vehicle: string;
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

const missingFact = (key: string) =>
    new ConflictError('contract_unmet', { detailKey: 'competency.errors.registration_missing_fact', params: { key } });

const words = (key: string): { am: string; en: string } => ({
    am: (vehiclesAm as Record<string, string>)[key] ?? key,
    en: (vehiclesEn as Record<string, string>)[key] ?? key
});

@Injectable()
export class BoloService {
    constructor(
        @Inject(VehiclesService) private readonly vehicles: VehiclesService,
        @Inject(DocumentsService) private readonly documents: DocumentsService,
        @Inject(StationeryStock) private readonly stationery: StationeryStock
    ) {}

    // ---- filing ----

    /**
     * What makes a bolo request acceptable, checked on the server: the vehicle is on the register and active; the third-party
     * insurance policy covers today (Proclamation 799/2013: an expired policy is refused); a vehicle of a use that pays the Road
     * Fund (plate codes 1 and 3) brings its receipt; and it has no bolo of this fiscal year already. Nothing is written.
     */
    async check(tx: Tx, _place: CasePlace, input: BoloInput) {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicle));
        if (!vehicle || vehicle.status !== 'active')
            return refuse('vehicle', 'not_active', 'competency.rule.boloNotActive');
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
        const { fiscalYear } = boloValidity(today);
        const [held] = await tx
            .select({ id: bolos.id })
            .from(bolos)
            .where(and(eq(bolos.vehicleId, vehicle.id), eq(bolos.fiscalYear, fiscalYear), ne(bolos.status, 'void')));
        if (held)
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.boloAlreadyHeld'),
                detailKey: 'competency.rule.boloAlreadyHeld'
            });
        return {
            vehicle: { id: vehicle.id },
            bolo: { vehicleId: vehicle.id, use: vehicle.use, insurance: insurance.data }
        };
    }

    // ---- the inspection ----

    /**
     * The inspector's step: the sheet's serial, the day, and the checklist, whose outcome the server worked out. `pass` makes the
     * bolo and is refused unless the checklist passed (a failed item blocks it); `fail` records the failed items and is refused
     * for a checklist that passed. Run again it returns what it made.
     */
    async inspect(tx: Tx, at: CasePlace, facts: Facts, input: unknown, result: 'pass' | 'fail') {
        const place = await actForHandlingOffice(tx, at);
        const entry = inspectionEntrySchema.safeParse(input);
        if (!entry.success)
            throw new ValidationError('validation_failed', {
                errors: entry.error.issues.map((i) => ({ path: i.path.join('.'), code: 'invalid', message: i.message }))
            });
        if (entry.data.inspectedOn > addisDay())
            return refuse('inspectedOn', 'future', 'competency.rule.boloInspectedLater');
        // the checklist as the step's answers were filed: its outcome is the one the server worked out (task 1.13a)
        const checklist = isRecord(input) && isRecord(input.inspection) ? input.inspection : undefined;
        const outcome = checklist && isRecord(checklist.outcome) ? checklist.outcome : undefined;
        const passed = outcome?.passed;
        if (result === 'pass' && passed !== true)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloNotPassed' });
        if (result === 'fail' && passed !== false)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloNotFailed' });
        const inspection = {
            checklistSerial: entry.data.checklistSerial,
            inspectedOn: entry.data.inspectedOn,
            passed,
            failed: Array.isArray(outcome?.failed) ? outcome.failed : [],
            total: outcome?.total,
            max: outcome?.max
        };
        if (result === 'fail') return { inspection };
        const asked = factOf(facts, 'bolo');
        const insurance = insuranceSchema.safeParse(asked?.insurance);
        if (typeof asked?.vehicleId !== 'string' || typeof asked.use !== 'string' || !insurance.success)
            throw missingFact('bolo');
        const [made] = await tx
            .select()
            .from(bolos)
            .where(and(eq(bolos.caseId, place.caseId), ne(bolos.status, 'void')));
        const validity = boloValidity(entry.data.inspectedOn);
        const bolo =
            made ??
            (await insertAudited(tx, bolos, {
                regionId: place.regionId,
                handlingUnitId: place.handlingUnitId,
                vehicleId: asked.vehicleId,
                caseId: place.caseId,
                use: asked.use,
                checklistSerial: entry.data.checklistSerial,
                inspectedOn: entry.data.inspectedOn,
                fiscalYear: validity.fiscalYear,
                validUntil: validity.validUntil,
                insuranceCertificate: insurance.data.certificate,
                insurer: insurance.data.insurer,
                insuredFrom: insurance.data.from,
                insuredUntil: insurance.data.until
            }));
        return {
            inspection,
            bolo: { ...asked, id: bolo.id, fiscalYear: bolo.fiscalYear, validUntil: bolo.validUntil }
        };
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
        const now =
            bolo.status === 'valid'
                ? bolo
                : await updateAudited(tx, bolos, bolo.id, bolo.rowVersion, {
                      status: 'valid',
                      stickerKey: item.itemKey
                  });
        const issued = await this.document(tx, place, now, BOLO_TEMPLATE, item.itemKey);
        const known = factOf(facts, 'documents') ?? {};
        return {
            bolo: { ...factOf(facts, 'bolo'), id: now.id, sticker: item.itemKey, status: now.status },
            documents: { ...known, [BOLO_TEMPLATE]: issued.id }
        };
    }

    /**
     * A temporary bolo while the office has no sticker of the vehicle's kind and year: numbered from the office's counter, it
     * stands for the configured days (`bolo_temporary_days`, 30 by default), never past the bolo's own last day. Issued once:
     * run again it returns the same one; once the sticker is given it is refused.
     */
    async issueTemporary(tx: Tx, at: CasePlace, facts: Facts, config: Readonly<Record<string, unknown>>) {
        const place = await actForHandlingOffice(tx, at);
        const bolo = await this.boloOf(tx, facts);
        if (bolo.status === 'valid')
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.boloStickerGiven' });
        const days =
            typeof config.bolo_temporary_days === 'number' && config.bolo_temporary_days > 0
                ? Math.floor(config.bolo_temporary_days)
                : DEFAULT_TEMPORARY_BOLO_DAYS;
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
