/**
 * A renewal's medical examination (task 1.6a, ADR-0052, ADR-0064 §4): the referral letter the office writes to a health facility,
 * the health bureau's report as it comes back, and the conditions a report grants with. The report's facility, day, number and
 * recommendation are typed; its findings stay on the paper. The conditions are a health fact: recorded by a command (never a form
 * answer), encrypted with the region's data key and bound to their row, and read in clear only through the audited reveal, by the
 * competency lead of the subtree that handles the case. A refused report may go to a second and a third institution (Art. 13 of
 * Proclamation 1074/2018), each another than those that refused.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { DATABASE } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import { FIELD_CRYPTO, reveal, type FieldCrypto } from '@itrms/kernel/crypto';
import { insertAudited, updateAudited, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { nextNumber, requireCounter } from '@itrms/kernel/numbering';
import { withinScope } from '@itrms/kernel/org';
import { SettingsService } from '@itrms/kernel/settings';
import { DocumentsService } from '@itrms/documents/api';
import { persons } from '@itrms/parties/api';
import { cases } from '@itrms/workflow/api';

import {
    addisDay,
    foldFacility,
    MAX_MEDICAL_INSTITUTIONS,
    MEDICAL_CONDITIONS_REVEALED_EVENT,
    MEDICAL_MONTHS_SETTING,
    MEDICAL_RECOMMENDATIONS,
    MEDICAL_REFERRAL_COUNTER,
    MEDICAL_REFERRAL_TEMPLATE,
    medicalIsCurrent,
    medicalReferralEntrySchema,
    medicalReportEntrySchema,
    type MedicalConditionsRevealed,
    type MedicalFacts,
    type MedicalRecommendation,
    type MedicalReport
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { driverLicences, licenceGrades, licenceGradeTypes, medicalCertificates } from './competency.table';
import { actForHandlingOffice } from './handling-office';
import type { CasePlace } from './licences.service';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;
type Certificate = typeof medicalCertificates.$inferSelect;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words, values: Record<string, string | number> = {}): string =>
    (currentContext()?.language === 'en' ? en : am)[key].replace(/\{(\w+)\}/g, (_, name: string) =>
        String(values[name] ?? '')
    );

const refuse = (path: string, code: string, key: Words, values?: Record<string, string | number>): never => {
    throw new ValidationError('validation_failed', { errors: [{ path, code, message: say(key, values) }] });
};

/** An entry the step's form let through that its schema does not: a 422 with the fields, never a 500. */
function parseEntry<S extends z.ZodType>(schema: S, answers: unknown): z.output<S> {
    const parsed = schema.safeParse(answers ?? {});
    if (parsed.success) return parsed.data;
    throw new ValidationError('validation_failed', {
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: 'invalid', message: i.message }))
    });
}

const missingFact = (key: string) =>
    new ConflictError('contract_unmet', { detailKey: 'competency.errors.case_missing_fact', params: { key } });

/** Where the conditions are encrypted: bound to their column and their report, so a ciphertext copied to another row does not open. */
const place = (reportId: string) => `competency.medical_certificates.conditions:${reportId}`;

const isRecommendation = (value: string | null): value is MedicalRecommendation =>
    value !== null && (MEDICAL_RECOMMENDATIONS as readonly string[]).includes(value);

/** What the case knows of its examination so far: none before the first referral or report. */
export function medicalFactsOf(facts: Facts): MedicalFacts {
    const m = facts.medical;
    const known = m !== null && typeof m === 'object' && !Array.isArray(m) ? (m as Partial<MedicalFacts>) : {};
    return {
        reports: typeof known.reports === 'number' ? known.reports : 0,
        refusals: typeof known.refusals === 'number' ? known.refusals : 0,
        referrals: typeof known.referrals === 'number' ? known.referrals : 0,
        latest: known.latest && isRecommendation(known.latest) ? known.latest : null,
        referredOn: typeof known.referredOn === 'string' ? known.referredOn : null
    };
}

/**
 * The states of DVC-04 after the lead's final approval: the renewal is with the national platform, on the conditions the lead
 * checked. A rejection by the platform returns it to the approval, where they may be corrected again.
 */
const SENT_ON: readonly string[] = ['national'];

/** A person acting always has a region and a scope: the guards saw to that. */
function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError();
    return value;
}

@Injectable()
export class MedicalReportService {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
        @Inject(DocumentsService) private readonly documents: DocumentsService,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    // ---- the steps ----

    /**
     * The referral letter to the facility named on the step, numbered from the office's counter. A second or a third follows a
     * refused report only, to another institution than those that refused; it supersedes the letter before it.
     */
    async issueReferral(tx: Tx, at: CasePlace, facts: Facts, answers: unknown, caseNumber: number) {
        const where = await actForHandlingOffice(tx, at);
        const entry = parseEntry(medicalReferralEntrySchema, answers);
        const medical = medicalFactsOf(facts);
        const reports = await this.reportsOf(tx, where.caseId, true);
        this.mayExamineAgain(reports);
        const refused = new Set(reports.map((r) => foldFacility(r.facility)));
        if (refused.has(foldFacility(entry.institution)))
            refuse('institution', 'same_institution', 'competency.rule.medicalSameInstitution');
        await requireCounter(tx, MEDICAL_REFERRAL_COUNTER, where.handlingUnitId);

        const licence = await this.licenceOf(tx, facts);
        const [holder] = await tx.select().from(persons).where(eq(persons.id, licence.personId));
        if (!holder) throw new NotFoundError();
        const language = currentContext()?.language === 'en' ? 'en' : 'am';
        const grades = await tx
            .select({ name: licenceGradeTypes.name })
            .from(licenceGrades)
            .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, licenceGrades.gradeTypeId))
            .where(eq(licenceGrades.licenceId, licence.id));
        const today = addisDay();
        const { number } = await nextNumber(tx, MEDICAL_REFERRAL_COUNTER, where.handlingUnitId);
        const name =
            language === 'en' && holder.givenNameEn
                ? [holder.givenNameEn, holder.fatherNameEn, holder.grandfatherNameEn]
                : [holder.givenNameAm, holder.fatherNameAm, holder.grandfatherNameAm];
        const letter = await this.documents.reissue(tx, {
            regionId: where.regionId,
            handlingUnitId: where.handlingUnitId,
            templateKey: MEDICAL_REFERRAL_TEMPLATE,
            language,
            number,
            caseId: where.caseId,
            subject: { table: 'workflow.cases', id: where.caseId },
            data: {
                number,
                issuedOn: today,
                caseNumber,
                institution: entry.institution,
                attempt: reports.length + 1,
                of: MAX_MEDICAL_INSTITUTIONS,
                holderName: name.filter(Boolean).join(' '),
                licence: {
                    number: licence.number ?? '',
                    cardSerial: licence.cardSerial,
                    validUntil: licence.validUntil,
                    grades: grades.map((g) => ({ name: g.name }))
                }
            }
        });
        const known = (facts.documents ?? {}) as Record<string, string>;
        return {
            medical: { ...medical, referrals: medical.referrals + 1, referredOn: today },
            documents: { ...known, [MEDICAL_REFERRAL_TEMPLATE]: letter.id }
        };
    }

    /**
     * The report as it came back, under its institution's turn (1–3). `fit` takes a grant, with or without conditions; `unfit` a
     * refusal. It is dated within the months a medical examination stands, and not before the referral it answers.
     */
    async recordReport(tx: Tx, at: CasePlace, facts: Facts, answers: unknown, outcome: string | undefined) {
        const where = await actForHandlingOffice(tx, at);
        const entry = parseEntry(medicalReportEntrySchema, answers);
        const fit = entry.recommendation !== 'refuse';
        if ((outcome === 'fit' && !fit) || (outcome === 'unfit' && fit) || (outcome !== 'fit' && outcome !== 'unfit'))
            refuse('recommendation', 'outcome', 'competency.rule.medicalOutcome');
        const today = addisDay();
        const months = await this.settings.value<number>(tx, where.handlingUnitId, MEDICAL_MONTHS_SETTING);
        if (!medicalIsCurrent(entry.examinedOn, months, today))
            refuse('examinedOn', 'not_current', 'competency.rule.medical', { months });
        const medical = medicalFactsOf(facts);
        if (medical.referredOn && entry.examinedOn < medical.referredOn)
            refuse('examinedOn', 'before_referral', 'competency.rule.medicalBeforeReferral');
        const reports = await this.reportsOf(tx, where.caseId, true);
        this.mayExamineAgain(reports);
        if (reports.some((r) => foldFacility(r.facility) === foldFacility(entry.facility)))
            refuse('facility', 'same_institution', 'competency.rule.medicalSameInstitution');
        const personId = facts.personId;
        if (typeof personId !== 'string') throw missingFact('personId');
        // after every row of the case: a certificate the request carried (a version 1 form) keeps its place
        const last = (await this.reportsOf(tx, where.caseId)).at(-1)?.sequence ?? 0;
        const made = await insertAudited(tx, medicalCertificates, {
            regionId: where.regionId,
            handlingUnitId: where.handlingUnitId,
            caseId: where.caseId,
            personId,
            sequence: last + 1,
            facility: entry.facility,
            examinedOn: entry.examinedOn,
            reportNumber: entry.reportNumber ?? null,
            recommendation: entry.recommendation
        });
        return {
            medical: {
                ...medical,
                reports: reports.length + 1,
                refusals: medical.refusals + (fit ? 0 : 1),
                latest: entry.recommendation,
                // the referral is answered: a next one is written after a refusal
                referredOn: null,
                reportId: made.id
            }
        };
    }

    /**
     * Another referral or report only after every report so far refused, and only up to the third institution. Only reports count:
     * a certificate typed with a request has no recommendation.
     */
    private mayExamineAgain(reports: readonly Certificate[]): void {
        if (reports.some((r) => r.recommendation !== 'refuse'))
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.medical_already_granted' });
        if (reports.length >= MAX_MEDICAL_INSTITUTIONS)
            refuse('institution', 'institutions_used', 'competency.rule.medicalInstitutions', {
                max: MAX_MEDICAL_INSTITUTIONS
            });
    }

    // ---- the conditions, by command ----

    /**
     * Records (or corrects) the conditions a report grants with, until the final approval: refused (409) for a report that grants
     * none, and once the lead has sent the renewal on (what the lead checked is what goes). The case is locked first, so an
     * approval and a correction never cross. The audit log says that they were recorded or changed, never to what.
     */
    async recordConditions(tx: Tx, ctx: DbContext, reportId: string, conditions: string): Promise<MedicalReport> {
        const regionId = required(ctx.regionId);
        const report = await this.handled(tx, ctx, reportId);
        if (report.recommendation !== 'grant_with_conditions')
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.medical_no_conditions' });
        const [kase] = await tx
            .select({ closedAt: cases.closedAt, state: cases.state })
            .from(cases)
            .where(eq(cases.id, report.caseId))
            .for('update');
        if (!kase || kase.closedAt !== null || SENT_ON.includes(kase.state))
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.medical_case_closed' });
        const ciphertext = await this.crypto.encrypt(tx, regionId, place(report.id), conditions);
        const [locked] = await tx
            .select({ rowVersion: medicalCertificates.rowVersion })
            .from(medicalCertificates)
            .where(eq(medicalCertificates.id, report.id))
            .for('update');
        if (!locked) throw new NotFoundError();
        const updated = await updateAudited(tx, medicalCertificates, report.id, locked.rowVersion, {
            conditionsCt: ciphertext
        });
        return this.out(updated);
    }

    /**
     * The conditions in clear, for the competency lead: the request (who, which report, why) is recorded first in a transaction of
     * its own, so it stays on record whatever happens next; only then is the report checked to be the lead's to read.
     */
    revealedConditions(ctx: DbContext, reportId: string, reason: string): Promise<MedicalConditionsRevealed> {
        const regionId = required(ctx.regionId);
        return reveal(
            this.db,
            ctx,
            {
                type: MEDICAL_CONDITIONS_REVEALED_EVENT,
                table: medicalCertificates,
                rowId: reportId,
                fields: ['conditions'],
                reason
            },
            async (tx) => {
                const report = await this.handled(tx, ctx, reportId);
                if (!report.conditionsCt) return { conditions: null };
                return { conditions: await this.crypto.decrypt(tx, regionId, place(report.id), report.conditionsCt) };
            }
        );
    }

    /** A case's reports, first institution first: whether conditions are on record, never what they are. */
    async list(tx: Tx, caseId: string): Promise<{ items: MedicalReport[] }> {
        return { items: (await this.reportsOf(tx, caseId)).map((r) => this.out(r)) };
    }

    // ---- helpers ----

    /** The case's rows, first first; `reportsOnly`, only the health bureau's reports (those with a recommendation). */
    private reportsOf(tx: Tx, caseId: string, reportsOnly = false): Promise<Certificate[]> {
        const ofCase = eq(medicalCertificates.caseId, caseId);
        return tx
            .select()
            .from(medicalCertificates)
            .where(reportsOnly ? and(ofCase, isNotNull(medicalCertificates.recommendation)) : ofCase)
            .orderBy(asc(medicalCertificates.sequence));
    }

    /** The report, when the caller's active subtree handles it (one elsewhere is "not found" here, as RLS would also say). */
    private async handled(tx: Tx, ctx: DbContext, reportId: string): Promise<Certificate> {
        const [report] = await tx.select().from(medicalCertificates).where(eq(medicalCertificates.id, reportId));
        if (!report || !withinScope(report.orgPath, required(ctx.scopePath))) throw new NotFoundError();
        return report;
    }

    private async licenceOf(tx: Tx, facts: Facts) {
        const id = (facts.renewal as { licenceId?: unknown } | undefined)?.licenceId;
        if (typeof id !== 'string') throw missingFact('renewal');
        const [licence] = await tx.select().from(driverLicences).where(eq(driverLicences.id, id));
        if (!licence) throw new NotFoundError();
        return licence;
    }

    private out(r: Certificate): MedicalReport {
        return {
            id: r.id,
            sequence: r.sequence,
            facility: r.facility,
            examinedOn: r.examinedOn,
            reportNumber: r.reportNumber,
            recommendation: isRecommendation(r.recommendation) ? r.recommendation : null,
            conditionsOnRecord: r.conditionsCt !== null,
            version: r.rowVersion
        };
    }
}
