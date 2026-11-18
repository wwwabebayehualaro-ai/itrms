/**
 * The replacement of a lost, stolen or damaged libre, DVC-06 (task 1.5, ADR-0062): what a request must meet, the newspaper notice
 * a lost or stolen libre waits out, and the step that replaces the libre in the register and supersedes its certificate. The
 * register is the vehicles slice's; this calls its command inside the transition's transaction, so a step that fails leaves
 * nothing, and run again it returns what it made. The libre's booklet is the registration's own step (`issueLibreBooklet`).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import { formatEthiopianLong, toEthiopian } from '@itrms/ethiopian-calendar';
import { currentContext } from '@itrms/kernel/context';
import { insertAudited, updateAudited, type Tx } from '@itrms/kernel/db';
import { ConflictError, ValidationError } from '@itrms/kernel/errors';
import { requireCounter } from '@itrms/kernel/numbering';
import { SettingsService } from '@itrms/kernel/settings';
import { StationeryStock } from '@itrms/fees/api';
import { EncumbranceService, libres, vehicles, VehicleRegistry } from '@itrms/vehicles/api';
import { REGISTRATION_CERTIFICATE_COUNTER } from '@itrms/vehicles/contracts';

import {
    addisDay,
    BOLO_TEMPLATE,
    DEFAULT_LIBRE_NOTICE_DAYS,
    LIBRE_NOTICE_DAYS_SETTING,
    REGISTRATION_CERTIFICATE_TEMPLATE,
    REPLACEMENT_ITEMS,
    REPLACEMENT_REASONS,
    type ReplacementItem,
    type ReplacementReason
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { daysAfter } from './bolo-validity';
import { BoloService } from './bolo.service';
import { bolos, replacements } from './competency.table';
import { actForHandlingOffice, claimedElsewhere, lockVehicleClaim } from './handling-office';
import type { CasePlace } from './licences.service';
import { VehicleRegistrationService } from './registration.service';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

const refuse = (path: string, code: string, key: Words): never => {
    throw new ValidationError('validation_failed', { errors: [{ path, code, message: say(key) }] });
};

/** The request's answers an effect reads, by contract path (see replacement.effects.ts). */
export type ReplacementInput = {
    /** the vehicle, picked from the register */
    vehicle: string;
    item: string;
    reason: string;
    /** its use, compared with the register as the plate exchange does (what the plate's fee is worked out from) */
    use: string;
    policeReportReference?: string;
    policeReportOn?: string;
    noticeNewspaper?: string;
    noticePublishedOn?: string;
    /** a damaged item is handed in, confirmed by the officer */
    oldItemHandedIn?: boolean;
};

const factObject = (facts: Facts, key: string): Record<string, unknown> | undefined => {
    const value = facts[key];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
};

const factText = (facts: Facts, key: string, field: string): string | undefined => {
    const value = factObject(facts, key)?.[field];
    return typeof value === 'string' && value !== '' ? value : undefined;
};

/** A stored day as the person reads it: Ethiopian, long form, in the language of the request. */
const ethiopianDay = (iso: string): string => {
    const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
    return formatEthiopianLong(toEthiopian({ year, month, day }), {
        language: currentContext()?.language === 'en' ? 'en' : 'am'
    });
};

const missingFact = (key: string) =>
    new ConflictError('contract_unmet', { detailKey: 'competency.errors.registration_missing_fact', params: { key } });

const isItem = (value: string | undefined): value is ReplacementItem =>
    (REPLACEMENT_ITEMS as readonly (string | undefined)[]).includes(value);
const isReason = (value: string | undefined): value is ReplacementReason =>
    (REPLACEMENT_REASONS as readonly (string | undefined)[]).includes(value);

/** A box left empty is no value. */
const given = (value: string | undefined): string | undefined =>
    value === undefined || value === '' ? undefined : value;

@Injectable()
export class ReplacementService {
    constructor(
        @Inject(VehicleRegistry) private readonly registry: VehicleRegistry,
        @Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService,
        @Inject(SettingsService) private readonly settings: SettingsService,
        @Inject(EncumbranceService) private readonly encumbrances: EncumbranceService,
        @Inject(BoloService) private readonly bolo: BoloService,
        @Inject(StationeryStock) private readonly stationery: StationeryStock
    ) {}

    // ---- filing ----

    /**
     * What makes a replacement acceptable, checked on the server: the vehicle is on the register and handled by the office the case
     * is in, its use is the register's, a lost or stolen item has its police letter and a damaged one is handed in, a libre in force
     * with its booklet is there to replace, a lost or stolen libre has its newspaper notice, the office can number the new
     * certificate, and no other open request claims the vehicle. A bolo sticker needs a bolo in force on its sticker, issued by this
     * office. Nothing is written. A libre's holds are checked here too (the encumbrance check, `replacement`), a bolo's are not.
     */
    async check(tx: Tx, place: CasePlace, input: ReplacementInput) {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicle));
        if (!vehicle || vehicle.status !== 'active')
            return refuse('vehicle', 'not_active', 'competency.rule.replacementNotActive');
        if (vehicle.handlingUnitId !== place.handlingUnitId)
            return refuse('vehicle', 'other_office', 'competency.rule.replacementOtherOffice');
        if (input.use !== vehicle.use) return refuse('use', 'mismatch', 'competency.rule.replacementUse');
        // the plate comes with task 1.5c
        const item = input.item;
        if (item !== 'libre' && item !== 'bolo')
            return refuse('item', 'not_yet', 'competency.rule.replacementItemLater');
        if (!isReason(input.reason)) return refuse('reason', 'invalid', 'competency.rule.replacementPoliceReport');
        const today = addisDay();
        const policeReportReference = given(input.policeReportReference);
        const policeReportOn = given(input.policeReportOn);
        if (input.reason === 'damaged') {
            if (input.oldItemHandedIn !== true)
                return refuse('oldItemHandedIn', 'required', 'competency.rule.replacementHandedIn');
        } else if (!policeReportReference || !policeReportOn || policeReportOn > today) {
            return refuse(
                !policeReportReference ? 'policeReportReference' : 'policeReportOn',
                'police_report',
                'competency.rule.replacementPoliceReport'
            );
        }
        if (item === 'bolo')
            return this.checkBolo(tx, place, vehicle.id, input.reason, {
                policeReportReference,
                policeReportOn
            });
        const [libre] = await tx
            .select()
            .from(libres)
            .where(and(eq(libres.vehicleId, vehicle.id), eq(libres.status, 'issued')));
        if (!libre) return refuse('vehicle', 'no_libre', 'competency.rule.replacementNoLibre');
        if (libre.number === null) return refuse('vehicle', 'no_booklet', 'competency.rule.replacementLibreNoBooklet');
        const noticeRequired = input.reason !== 'damaged';
        const noticeNewspaper = given(input.noticeNewspaper);
        const noticePublishedOn = given(input.noticePublishedOn);
        if (noticeRequired) {
            if (!noticeNewspaper || !noticePublishedOn)
                return refuse(
                    !noticeNewspaper ? 'noticeNewspaper' : 'noticePublishedOn',
                    'notice',
                    'competency.rule.replacementNotice'
                );
            if (noticePublishedOn > today)
                return refuse('noticePublishedOn', 'future', 'competency.rule.replacementNoticeDate');
        }
        // the new libre's certificate is numbered from the office's counter: an office with none finds out now
        await requireCounter(tx, REGISTRATION_CERTIFICATE_COUNTER, place.handlingUnitId);
        // two requests for one vehicle filed at the same moment: the second waits for the first's transaction, then sees its facts
        await lockVehicleClaim(tx, vehicle.id);
        if (await claimedElsewhere(tx, place.caseId, { vehicleId: vehicle.id }))
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.replacementInOpenCase'),
                detailKey: 'competency.rule.replacementInOpenCase'
            });
        // a hold blocks a libre, not a bolo sticker (ADR-0062): checked here, since the filing step cannot tell the two apart
        await this.encumbrances.assertClear(tx, vehicle.id, 'replacement', place.handlingUnitId);
        const noticeEndsOn =
            noticeRequired && noticePublishedOn
                ? daysAfter(noticePublishedOn, await this.noticeDays(tx, place.handlingUnitId))
                : undefined;
        return {
            vehicle: { id: vehicle.id },
            replacement: {
                vehicleId: vehicle.id,
                item,
                reason: input.reason,
                noticeRequired,
                libreId: libre.id,
                ...(policeReportReference ? { policeReportReference } : {}),
                ...(policeReportOn ? { policeReportOn } : {}),
                ...(noticeNewspaper ? { noticeNewspaper } : {}),
                ...(noticePublishedOn ? { noticePublishedOn } : {}),
                ...(noticeEndsOn ? { noticeEndsOn } : {})
            }
        };
    }

    /**
     * The bolo of a vehicle whose sticker is replaced: one in force (an expired bolo needs a new inspection, DVC-02) carried on its
     * sticker and issued by this office. No newspaper notice and no hold check: a hold is about the title, a bolo about roadworthiness.
     */
    private async checkBolo(
        tx: Tx,
        place: CasePlace,
        vehicleId: string,
        reason: ReplacementReason,
        police: { policeReportReference: string | undefined; policeReportOn: string | undefined }
    ) {
        const [bolo] = await tx
            .select()
            .from(bolos)
            .where(and(eq(bolos.vehicleId, vehicleId), ne(bolos.status, 'void'), gte(bolos.validUntil, addisDay())))
            .orderBy(desc(bolos.validUntil))
            .limit(1);
        if (!bolo) return refuse('vehicle', 'no_bolo', 'competency.rule.replacementNoBolo');
        if (bolo.status !== 'valid' || bolo.stickerKey === null)
            return refuse('vehicle', 'no_sticker', 'competency.rule.replacementTemporaryBolo');
        if (bolo.handlingUnitId !== place.handlingUnitId)
            return refuse('vehicle', 'bolo_other_office', 'competency.rule.replacementBoloOtherOffice');
        await lockVehicleClaim(tx, vehicleId);
        if (await claimedElsewhere(tx, place.caseId, { vehicleId }))
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.replacementInOpenCase'),
                detailKey: 'competency.rule.replacementInOpenCase'
            });
        return {
            vehicle: { id: vehicleId },
            replacement: {
                vehicleId,
                item: 'bolo',
                reason,
                noticeRequired: false,
                boloId: bolo.id,
                oldStickerKey: bolo.stickerKey,
                ...(police.policeReportReference ? { policeReportReference: police.policeReportReference } : {}),
                ...(police.policeReportOn ? { policeReportOn: police.policeReportOn } : {})
            }
        };
    }

    // ---- the notice period ----

    /**
     * The notice period of a lost or stolen libre is over: the publication day plus the setting's days, worked out again with
     * today's setting. The workflow engine counts business days only and cannot wait for a computed date, so the officer takes
     * the step and this refuses it before the day.
     */
    async checkNotice(tx: Tx, place: CasePlace, facts: Facts) {
        const replacement = factObject(facts, 'replacement');
        if (replacement?.noticeRequired !== true) return {};
        const publishedOn = factText(facts, 'replacement', 'noticePublishedOn');
        if (!publishedOn) throw missingFact('replacement');
        const endsOn = daysAfter(publishedOn, await this.noticeDays(tx, place.handlingUnitId));
        if (addisDay() < endsOn)
            throw new ConflictError('invalid_transition', {
                detailKey: 'competency.rule.replacementNoticeRunning',
                params: { endsOn: ethiopianDay(endsOn) }
            });
        return { replacement: { ...replacement, noticeEndsOn: endsOn } };
    }

    // ---- the replacement ----

    /**
     * The libre in force leaves force (lost for a lost or stolen one, replaced for a damaged one) and the same owners' new libre is
     * issued, with no number until its booklet; the old libre's certificate says superseded and the new libre has one of its own.
     * The notice period is checked again here when the libre was lost or stolen. Run again it returns what it made.
     */
    async replaceLibre(tx: Tx, at: CasePlace, facts: Facts, template: string | undefined) {
        const place = await actForHandlingOffice(tx, at);
        const templateKey = template || REGISTRATION_CERTIFICATE_TEMPLATE;
        const vehicleId = factText(facts, 'vehicle', 'id');
        const replacement = factObject(facts, 'replacement');
        const reason = factText(facts, 'replacement', 'reason');
        if (!vehicleId || !replacement || !isReason(reason)) throw missingFact('replacement');
        const known = factObject(facts, 'documents') ?? {};
        const [locked] = await tx
            .select()
            .from(replacements)
            .where(eq(replacements.caseId, place.caseId))
            .for('update');
        if (locked?.replacedOn && locked.newLibreId) {
            const [libre] = await tx.select().from(libres).where(eq(libres.id, locked.newLibreId));
            if (!libre || !locked.oldLibreId) throw missingFact('replacement');
            const certificate = await this.registration.supersedeCertificate(tx, place, libre, templateKey);
            return {
                libre: { id: libre.id, number: libre.number, template: templateKey },
                documents: { ...known, [templateKey]: certificate.id }
            };
        }
        if (replacement.noticeRequired === true) await this.checkNotice(tx, place, facts);
        const row = locked ?? (await this.insertRow(tx, place, facts, reason));
        const today = addisDay();
        const made = await this.registry.replaceLibre(tx, place.ctx, vehicleId, {
            issuedOn: today,
            caseId: place.caseId,
            outgoing: reason === 'damaged' ? 'replaced' : 'lost'
        });
        const certificate = await this.registration.supersedeCertificate(tx, place, made.libre, templateKey);
        await updateAudited(tx, replacements, row.id, row.rowVersion, {
            oldLibreId: made.old.id,
            newLibreId: made.libre.id,
            replacedOn: today,
            replacedBy: place.ctx.userId ?? null
        });
        return {
            libre: { id: made.libre.id, number: made.libre.number, template: templateKey },
            documents: { ...known, [templateKey]: certificate.id }
        };
    }

    /**
     * The bolo takes a new sticker from the office's stationery (the one the officer names, or the next one): the same bolo keeps
     * its year and last day, the old sticker's serial is kept on the replacement, and the bolo document is reissued with the new
     * sticker so the old QR reads superseded. With no sticker in stock the step is refused and the case waits. The stock item is
     * used for the replacement, not for the bolo, which would hand back the old sticker. Run again it returns what it made.
     */
    async replaceBoloSticker(tx: Tx, at: CasePlace, facts: Facts, answers: unknown) {
        const place = await actForHandlingOffice(tx, at);
        const boloId = factText(facts, 'replacement', 'boloId');
        const reason = factText(facts, 'replacement', 'reason');
        if (!boloId || !isReason(reason)) throw missingFact('replacement');
        const known = factObject(facts, 'documents') ?? {};
        const [locked] = await tx
            .select()
            .from(replacements)
            .where(eq(replacements.caseId, place.caseId))
            .for('update');
        const result = (sticker: string, document: string) => ({
            bolo: { id: boloId, sticker },
            documents: { ...known, [BOLO_TEMPLATE]: document }
        });
        if (locked?.replacedOn && locked.newStickerKey) {
            const done = await this.bolo.replaceSticker(tx, place, boloId, locked.newStickerKey);
            return result(locked.newStickerKey, done.document.id);
        }
        const row = locked ?? (await this.insertRow(tx, place, facts, reason));
        const current = await this.bolo.replaceable(tx, place, boloId);
        const serial = factObject({ answers }, 'answers')?.stickerSerial;
        const named = typeof serial === 'string' ? serial.trim() : '';
        const item = await this.stationery.use(tx, place.ctx, {
            kind: 'bolo_sticker',
            ...(named ? { key: named } : {}),
            variant: current.use,
            validEfy: current.fiscalYear,
            usedFor: { table: 'competency.replacements', id: row.id },
            caseId: place.caseId
        });
        const made = await this.bolo.replaceSticker(tx, place, boloId, item.itemKey);
        await updateAudited(tx, replacements, row.id, row.rowVersion, {
            boloId,
            oldStickerKey: current.stickerKey,
            newStickerKey: item.itemKey,
            replacedOn: addisDay(),
            replacedBy: place.ctx.userId ?? null
        });
        return result(item.itemKey, made.document.id);
    }

    // ---- helpers ----

    /** The case's row, made from the facts the filing kept. */
    private async insertRow(tx: Tx, place: CasePlace, facts: Facts, reason: ReplacementReason) {
        const item = factText(facts, 'replacement', 'item');
        const vehicleId = factText(facts, 'replacement', 'vehicleId');
        if (!isItem(item) || !vehicleId) throw missingFact('replacement');
        const text = (field: string) => factText(facts, 'replacement', field) ?? null;
        return insertAudited(tx, replacements, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            caseId: place.caseId,
            vehicleId,
            item,
            reason,
            policeReportReference: text('policeReportReference'),
            policeReportOn: text('policeReportOn'),
            noticeNewspaper: text('noticeNewspaper'),
            noticePublishedOn: text('noticePublishedOn'),
            noticeEndsOn: text('noticeEndsOn')
        });
    }

    /** A number of days the office's settings give, or the default when the setting is not a positive whole number. */
    private async noticeDays(tx: Tx, unitId: string): Promise<number> {
        const value = await this.settings.value<unknown>(tx, unitId, LIBRE_NOTICE_DAYS_SETTING);
        return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : DEFAULT_LIBRE_NOTICE_DAYS;
    }
}
