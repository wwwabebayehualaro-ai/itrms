/**
 * The back-capture of a paper driver licence, MIG-02 (ADR-0054, ADR-0051 §4, ADR-0064 §6, task 1.6b): what a capture must meet, the
 * step that puts the licence on the register once a second person has verified it against the paper, and the flag a printed number
 * becomes when it cannot be kept. The licence keeps the number and the card serial printed on it, and is active with no national
 * reference until task 1.14 reconciles it. A number is never renumbered: one inside the range the region reserved for ITRMS, or one
 * another licence of the region carries, cannot join the register; the second person flags it to the bureau instead.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { currentContext } from '@itrms/kernel/context';
import { insertAudited, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError } from '@itrms/kernel/errors';
import { SettingsService } from '@itrms/kernel/settings';
import { orgUnits } from '@itrms/kernel/tables';
import { persons } from '@itrms/parties/api';
import { cases } from '@itrms/workflow/api';

import {
    addisDay,
    capturedGradeSchema,
    foldCardSerial,
    foldLicenceNumber,
    inLicenceRange,
    isCardSerial,
    isPaperLicenceNumber,
    lapseOf,
    LICENCE_CAPTURE_EXAM_NOTICE,
    LICENCE_CAPTURE_EXPIRED_DEFAULT,
    LICENCE_CAPTURE_EXPIRED_NOTICE,
    LICENCE_CAPTURE_EXPIRED_SETTING,
    LICENCE_NUMBER_CONFLICT_NOTICE,
    licenceCaptureExpiredSchema,
    licenceKindSchema,
    type LicenceCaptureInput,
    type LicenceNumberConflict,
    type LicenceNumberFlag
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { driverLicences, licenceGrades, licenceGradeTypes, licenceNumberFlags } from './competency.table';
import { actForHandlingOffice } from './handling-office';
import { licenceNumbering } from './licence-numbers';
import type { CasePlace } from './licences.service';
import { refuse, type Refusal } from './paper-records';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;

/** A refusal in the language of the person acting: this is what they read at the desk. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

/** The capture as the register will keep it. */
interface Captured {
    personId: string;
    number: string;
    cardSerial: string | null;
    kind: z.infer<typeof licenceKindSchema>;
    issuedOn: string;
    validUntil: string;
    issuedBy: string | null;
    paperReference: string;
    grades: { gradeTypeId: string; key: string; permanentSince: string | null }[];
}

const gradeRows = z.array(capturedGradeSchema.extend({ grade: z.string().trim().min(1).max(40) }));

@Injectable()
export class LicenceCaptureService {
    constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

    // ---- filing ----

    /**
     * What makes a capture acceptable, on the server: a person on the register who holds no licence in the region, a printed number
     * and serial of the right shape, days that make sense, grades the region offers. Nothing is written. A number that cannot be kept
     * as printed is not refused here: the case goes on to the second person, who flags it (the case page shows why).
     */
    async check(tx: Tx, place: CasePlace, input: LicenceCaptureInput) {
        const captured = await this.captured(tx, place, input);
        const conflict = await this.conflictOf(tx, place, captured.number);
        // a licence past its expiry joins as expired; over a year late its renewal will need a practical exam (Art. 19(5))
        const lapse = lapseOf(captured.validUntil, addisDay());
        return {
            personId: captured.personId,
            licenceCapture: {
                number: captured.number,
                conflict,
                notices: [
                    ...(conflict ? [LICENCE_NUMBER_CONFLICT_NOTICE] : []),
                    ...(lapse.expired ? [LICENCE_CAPTURE_EXPIRED_NOTICE] : []),
                    ...(lapse.lateOverYear ? [LICENCE_CAPTURE_EXAM_NOTICE] : [])
                ]
            }
        };
    }

    /**
     * The second person's step: the licence joins the register as printed, marked as migrated and verified by them. A number that
     * cannot be kept (found now, or since the filing) is refused (409): it is flagged instead.
     */
    async capture(tx: Tx, at: CasePlace, input: LicenceCaptureInput) {
        const place = await actForHandlingOffice(tx, at);
        const verifiedBy = place.ctx.userId;
        if (!verifiedBy) throw new ForbiddenError();
        const captured = await this.captured(tx, place, input);
        // two captures of one number queue here, so the second sees the first's licence
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`competency.licence-number:${place.regionId}:${captured.number}`}, 0))`
        );
        if (await this.conflictOf(tx, place, captured.number))
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.licence_number_conflict' });
        // one licence per person (ADR-0064 §1), checked again under the holder's locks: two captures of one person queue on the
        // first, and a first licence's issuance of the same grade on the second (LicencesService.createPending), in grade order
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`competency.licence-holder:${place.regionId}:${captured.personId}`}, 0))`
        );
        for (const gradeTypeId of captured.grades.map((g) => g.gradeTypeId).sort())
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`competency.licence:${captured.personId}:${gradeTypeId}`}, 0))`
            );
        if (await this.holds(tx, place.regionId, captured.personId))
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.licence_already_held' });
        const licence = await insertAudited(tx, driverLicences, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            personId: captured.personId,
            number: captured.number,
            status: 'active',
            kind: captured.kind,
            issuedOn: captured.issuedOn,
            validUntil: captured.validUntil,
            cardSerial: captured.cardSerial,
            caseId: place.caseId,
            migrationSource: 'back_capture',
            paperReference: captured.paperReference,
            issuedBy: captured.issuedBy,
            migrationCaseId: place.caseId,
            migrationVerifiedBy: verifiedBy,
            migrationVerifiedAt: new Date()
        });
        for (const grade of captured.grades)
            await insertAudited(tx, licenceGrades, {
                regionId: place.regionId,
                handlingUnitId: place.handlingUnitId,
                licenceId: licence.id,
                gradeTypeId: grade.gradeTypeId,
                permanentSince: grade.permanentSince
            });
        return { licence: { id: licence.id, number: licence.number } };
    }

    /**
     * The second person's other step: the printed number cannot be kept, so it is flagged to the bureau and the licence does not
     * join the register. Refused (409) for a number that can be kept: that capture is verified, never flagged.
     */
    async flag(tx: Tx, at: CasePlace, input: LicenceCaptureInput, facts: Facts, comment?: string) {
        const place = await actForHandlingOffice(tx, at);
        const number = foldLicenceNumber(String(input.number ?? ''));
        const conflict = await this.conflictOf(tx, place, number);
        if (!conflict)
            throw new ConflictError('invalid_transition', {
                detailKey: 'competency.errors.licence_number_no_conflict'
            });
        const [existing] = await tx
            .select({ id: licenceNumberFlags.id })
            .from(licenceNumberFlags)
            .where(eq(licenceNumberFlags.caseId, place.caseId));
        const flag =
            existing ??
            (await insertAudited(tx, licenceNumberFlags, {
                regionId: place.regionId,
                handlingUnitId: place.handlingUnitId,
                caseId: place.caseId,
                number,
                reason: conflict,
                paperReference: input.paperReference.trim(),
                // the second person's reason, as they gave it with the flag: what the bureau reads beside the number
                note: comment?.trim() || null
            }));
        const known = (facts.licenceCapture ?? {}) as Record<string, unknown>;
        return { licenceCapture: { ...known, number, conflict, flagId: flag.id } };
    }

    // ---- the bureau's list ----

    /** The printed numbers flagged in the caller's subtree, the latest first. */
    async flags(tx: Tx, query: { limit: number }): Promise<{ items: LicenceNumberFlag[] }> {
        const rows = await tx
            .select()
            .from(licenceNumberFlags)
            .orderBy(desc(licenceNumberFlags.createdAt))
            .limit(query.limit);
        if (rows.length === 0) return { items: [] };
        const units = await tx
            .select({ id: orgUnits.id, code: orgUnits.code, name: orgUnits.name })
            .from(orgUnits)
            .where(
                inArray(
                    orgUnits.id,
                    rows.map((r) => r.handlingUnitId)
                )
            );
        const numbers = await tx
            .select({ id: cases.id, number: cases.number })
            .from(cases)
            .where(
                inArray(
                    cases.id,
                    rows.map((r) => r.caseId)
                )
            );
        return {
            items: rows.map((r) => ({
                id: r.id,
                number: r.number,
                reason: r.reason,
                caseId: r.caseId,
                caseNumber: numbers.find((c) => c.id === r.caseId)?.number ?? null,
                paperReference: r.paperReference,
                handlingUnit: units.find((u) => u.id === r.handlingUnitId) ?? {
                    id: r.handlingUnitId,
                    code: '',
                    name: {}
                },
                note: r.note,
                flaggedAt: r.createdAt.toISOString()
            }))
        };
    }

    // ---- helpers ----

    /** Whether the person holds a licence in the region that is not voided. */
    private async holds(tx: Tx, regionId: string, personId: string): Promise<boolean> {
        const [held] = await tx
            .select({ id: driverLicences.id })
            .from(driverLicences)
            .where(
                and(
                    eq(driverLicences.regionId, regionId),
                    eq(driverLicences.personId, personId),
                    ne(driverLicences.status, 'voided')
                )
            )
            .limit(1);
        return held !== undefined;
    }

    /**
     * Why a printed number cannot join the register, or null: inside the range ITRMS numbers from (ADR-0051 §4), or on another licence
     * of the region, a voided one too, as the unique number index counts it (the register is class R: the region reads every licence).
     */
    private async conflictOf(tx: Tx, place: CasePlace, number: string): Promise<LicenceNumberConflict | null> {
        if (inLicenceRange(number, await licenceNumbering(this.settings, tx, place.handlingUnitId)))
            return 'in_regional_range';
        const [taken] = await tx
            .select({ id: driverLicences.id })
            .from(driverLicences)
            .where(and(eq(driverLicences.regionId, place.regionId), eq(driverLicences.number, number)))
            .limit(1);
        return taken ? 'number_taken' : null;
    }

    /** The capture's answers checked and folded as the register keeps them; every refusal at once, on its box. */
    private async captured(tx: Tx, place: CasePlace, input: LicenceCaptureInput): Promise<Captured> {
        const errors: Refusal[] = [];
        const today = addisDay();
        const number = foldLicenceNumber(String(input.number ?? ''));
        if (!isPaperLicenceNumber(number))
            errors.push({ path: 'number', code: 'invalid', message: say('competency.rule.licenceNumberFormat') });
        const serialText = input.cardSerial?.trim();
        const cardSerial = serialText ? foldCardSerial(serialText) : null;
        if (cardSerial && !isCardSerial(cardSerial))
            errors.push({ path: 'cardSerial', code: 'invalid', message: say('competency.rule.cardSerialFormat') });
        const kind = licenceKindSchema.safeParse(input.kind);
        if (!kind.success) errors.push({ path: 'kind', code: 'invalid', message: say('competency.rule.licenceKind') });
        if (input.issuedOn > today)
            errors.push({ path: 'issuedOn', code: 'in_future', message: say('competency.rule.notInFuture') });
        if (input.validUntil <= input.issuedOn)
            errors.push({ path: 'validUntil', code: 'before_issue', message: say('competency.rule.validBeforeIssue') });
        // which expired licences the region captures (a setting; by default every one, as Art. 19 keeps them renewable)
        const lapse = lapseOf(input.validUntil, today);
        if (lapse.expired) {
            const parsed = licenceCaptureExpiredSchema.safeParse(
                await this.settings.value(tx, place.handlingUnitId, LICENCE_CAPTURE_EXPIRED_SETTING)
            );
            const policy = parsed.success ? parsed.data : LICENCE_CAPTURE_EXPIRED_DEFAULT;
            if (policy === 'refuse' || (policy === 'refuse_late' && lapse.lateOverYear))
                errors.push({
                    path: 'validUntil',
                    code: 'expired',
                    message: say(
                        policy === 'refuse' ? 'competency.rule.capturedExpired' : 'competency.rule.capturedExpiredLate'
                    )
                });
        }

        const [holder] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, input.person));
        if (!holder) errors.push({ path: 'person', code: 'not_found', message: say('competency.rule.personNotFound') });
        // one licence per person (ADR-0064 §1): a holder with a licence in the region renews or upgrades that one
        if (await this.holds(tx, place.regionId, input.person))
            errors.push({ path: 'person', code: 'already_held', message: say('competency.rule.licenceAlreadyHeld') });
        if (cardSerial) {
            const [serialTaken] = await tx
                .select({ id: driverLicences.id })
                .from(driverLicences)
                .where(and(eq(driverLicences.regionId, place.regionId), eq(driverLicences.cardSerial, cardSerial)))
                .limit(1);
            if (serialTaken)
                errors.push({ path: 'cardSerial', code: 'taken', message: say('competency.rule.cardSerialTaken') });
        }

        const rows = gradeRows.safeParse(input.grades ?? []);
        const grades: Captured['grades'] = [];
        if (!rows.success || rows.data.length === 0)
            errors.push({ path: 'grades', code: 'required', message: say('competency.rule.capturedGrades') });
        else {
            const keys = rows.data.map((r) => r.grade);
            const known = await tx
                .select({ id: licenceGradeTypes.id, key: licenceGradeTypes.key, active: licenceGradeTypes.active })
                .from(licenceGradeTypes)
                .where(and(eq(licenceGradeTypes.regionId, place.regionId), inArray(licenceGradeTypes.key, keys)));
            rows.data.forEach((row, i) => {
                const type = known.find((g) => g.key === row.grade);
                if (!type?.active || keys.indexOf(row.grade) !== i) {
                    errors.push({
                        path: `grades.${i}.grade`,
                        code: 'invalid',
                        message: say('competency.rule.capturedGrades')
                    });
                    return;
                }
                const since = row.permanentSince ?? null;
                if (since && since > today)
                    errors.push({
                        path: `grades.${i}.permanentSince`,
                        code: 'in_future',
                        message: say('competency.rule.notInFuture')
                    });
                // a permanent licence's grades are permanent: since the paper says, else since this licence was issued
                const permanentSince = kind.success && kind.data === 'permanent' ? (since ?? input.issuedOn) : null;
                grades.push({ gradeTypeId: type.id, key: type.key, permanentSince });
            });
        }
        if (errors.length > 0 || !kind.success) return refuse(errors);
        return {
            personId: input.person,
            number,
            cardSerial,
            kind: kind.data,
            issuedOn: input.issuedOn,
            validUntil: input.validUntil,
            issuedBy: input.issuedBy?.trim() || null,
            paperReference: input.paperReference.trim(),
            grades
        };
    }
}
