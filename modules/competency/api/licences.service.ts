/**
 * The licence rules applied to the register (task 0.24a): what an application must meet, and each step of a licence's life. The
 * effects are thin over this. A licence stays `pending_national` until the national platform accepts it, and a renewal changes
 * nothing until then, so ITRMS never holds a value that competes with the national record.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { nextNumber } from '@itrms/kernel/numbering';
import { emit } from '@itrms/kernel/outbox';
import { orgUnits } from '@itrms/kernel/tables';
import { DocumentsService } from '@itrms/documents/api';
import { organisations, persons, PersonsService } from '@itrms/parties/api';
import { SettingsService } from '@itrms/kernel/settings';
import { cases } from '@itrms/workflow/api';
import type { I18nText } from '@itrms/schemas';
import type { z } from 'zod';

import {
    addisDay,
    eligibilityProblems,
    enrolmentCreateSchema,
    examAnswersSchema,
    LICENCE_CARD_TEMPLATE,
    LICENCE_COUNTER,
    licenceSchema,
    licenceGradeSchema,
    medicalIsCurrent,
    nationalAnswerSchema,
    MEDICAL_MONTHS_SETTING,
    renewalIsOpen,
    renewalTerms,
    RENEWAL_WINDOW_SETTING,
    temporaryValidUntil,
    type EligibilityProblem,
    type Licence,
    type LicenceGrade
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import {
    driverLicences,
    examResults,
    examSessions,
    licenceGrades,
    licenceGradeTypes,
    licencePrintBatches,
    licencePrintBatchItems,
    medicalCertificates,
    trainingEnrolments
} from './competency.table';

/** A case's place, as an effect is given it, and who is acting (nobody, for the worker's system transactions). */
export interface CasePlace {
    caseId: string;
    regionId: string;
    handlingUnitId: string;
    ctx: DbContext;
}

type LicenceRow = typeof driverLicences.$inferSelect;
type GradeRow = typeof licenceGradeTypes.$inferSelect;
type Words = keyof typeof am;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words, values: Record<string, string | number> = {}): string => {
    const words = currentContext()?.language === 'en' ? en : am;
    return words[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
};

/** A person's refusal: what they read at the counter (api-guidelines.md: a business rule is a 422). */
const notEligible = (detail: string) => new ValidationError('not_eligible', { detail });

const fullName = (given: string, father: string, grandfather: string | null) =>
    [given, father, grandfather].filter(Boolean).join(' ');

const textIn = (name: I18nText, language: string) => (name as Record<string, string>)[language] ?? name.am;

@Injectable()
export class LicencesService {
    constructor(
        @Inject(PersonsService) private readonly persons: PersonsService,
        @Inject(DocumentsService) private readonly documents: DocumentsService,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    // ---- the catalogue ----

    async grades(tx: Tx): Promise<LicenceGrade[]> {
        const rows = await tx.select().from(licenceGradeTypes).orderBy(asc(licenceGradeTypes.key));
        return rows.map((g) => licenceGradeSchema.parse({ ...g, name: g.name }));
    }

    private async grade(tx: Tx, regionId: string, key: string): Promise<GradeRow> {
        const [grade] = await tx
            .select()
            .from(licenceGradeTypes)
            .where(and(eq(licenceGradeTypes.regionId, regionId), eq(licenceGradeTypes.key, key)));
        if (!grade?.active)
            throw new ConflictError('not_configured', { detail: `The licence grade ${key} is not offered here.` });
        return grade;
    }

    /** What a person holds now: a licence past its expiry proves nothing, whatever its status says. */
    private async heldBy(tx: Tx, personId: string, today: string) {
        return tx
            .select({ key: licenceGradeTypes.key, permanentSince: licenceGrades.permanentSince })
            .from(licenceGrades)
            .innerJoin(driverLicences, eq(driverLicences.id, licenceGrades.licenceId))
            .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, licenceGrades.gradeTypeId))
            .where(
                and(
                    eq(driverLicences.personId, personId),
                    eq(driverLicences.status, 'active'),
                    gte(driverLicences.validUntil, today)
                )
            );
    }

    /** A grade they already have, or are waiting for: asking again would make a second licence for one grade. */
    /** Another open request for the grade: the licence itself is made only at final approval, so two could otherwise both get there. */
    private async anotherRequest(tx: Tx, place: CasePlace, personId: string, grade: string): Promise<boolean> {
        const [other] = await tx
            .select({ id: cases.id })
            .from(cases)
            .where(
                and(
                    isNull(cases.closedAt),
                    ne(cases.id, place.caseId),
                    sql`${cases.facts}->>'personId' = ${personId}`,
                    sql`${cases.facts}#>>'{application,grade}' = ${grade}`
                )
            )
            .limit(1);
        return Boolean(other);
    }

    private async alreadyHas(tx: Tx, personId: string, gradeId: string, today: string): Promise<boolean> {
        const [found] = await tx
            .select({ id: driverLicences.id })
            .from(licenceGrades)
            .innerJoin(driverLicences, eq(driverLicences.id, licenceGrades.licenceId))
            .where(
                and(
                    eq(driverLicences.personId, personId),
                    eq(licenceGrades.gradeTypeId, gradeId),
                    sql`(${driverLicences.status} = 'pending_national' or (${driverLicences.status} = 'active' and ${driverLicences.validUntil} >= ${today}))`
                )
            )
            .limit(1);
        return Boolean(found);
    }

    private async birthDate(tx: Tx, place: CasePlace, personId: string, reason: string): Promise<string> {
        const born = await this.persons.birthDateForRule(tx, place.ctx, place.regionId, personId, reason);
        if (!born) throw notEligible(say('competency.rule.noBirthDate'));
        return born;
    }

    private problemText(problem: EligibilityProblem): string {
        switch (problem.code) {
            case 'too_young':
                return say('competency.rule.tooYoung', { min: problem.minAge });
            case 'education':
                return say('competency.rule.education', { min: problem.minEducation });
            case 'prerequisite':
                return say('competency.rule.prerequisite', {
                    months: problem.months,
                    grades: problem.grades.join(', ')
                });
        }
    }

    // ---- filing ----

    /** What makes a first application acceptable (Art. 12–14), checked on the server, and the facts it leaves. */
    async checkApplication(
        tx: Tx,
        place: CasePlace,
        input: {
            person: string;
            grade: string;
            educationGrade: number;
            school: string;
            medicalFacility: string;
            medicalExaminedOn: string;
        }
    ) {
        const today = addisDay();
        const grade = await this.grade(tx, place.regionId, input.grade);
        const problems = eligibilityProblems(
            { ...grade, prerequisites: grade.prerequisites },
            {
                birthDate: await this.birthDate(tx, place, input.person, 'licence eligibility'),
                educationGrade: input.educationGrade,
                held: await this.heldBy(tx, input.person, today)
            },
            today
        ).map((p) => this.problemText(p));
        if (
            (await this.alreadyHas(tx, input.person, grade.id, today)) ||
            (await this.anotherRequest(tx, place, input.person, grade.key))
        )
            problems.push(say('competency.rule.alreadyHeld'));
        const months = await this.settings.value<number>(tx, place.handlingUnitId, MEDICAL_MONTHS_SETTING);
        if (!medicalIsCurrent(input.medicalExaminedOn, months, today))
            problems.push(say('competency.rule.medical', { months }));
        const [school] = await tx
            .select({ kind: organisations.kind })
            .from(organisations)
            .where(eq(organisations.id, input.school));
        const [trained] = await tx
            .select({ status: trainingEnrolments.status })
            .from(trainingEnrolments)
            .where(
                and(
                    eq(trainingEnrolments.personId, input.person),
                    eq(trainingEnrolments.schoolId, input.school),
                    eq(trainingEnrolments.gradeTypeId, grade.id)
                )
            );
        // Art. 8 and DVC-10: only after the school has confirmed completion
        if (school?.kind !== 'training_school' || trained?.status !== 'completed')
            problems.push(say('competency.rule.training'));
        if (problems.length) throw notEligible(problems.join(' '));
        await this.recordMedical(tx, place, input.person, input.medicalFacility, input.medicalExaminedOn);
        return { personId: input.person, application: { grade: grade.key } };
    }

    private async recordMedical(tx: Tx, place: CasePlace, personId: string, facility: string, examinedOn: string) {
        const [existing] = await tx
            .select()
            .from(medicalCertificates)
            .where(eq(medicalCertificates.caseId, place.caseId));
        if (existing) {
            await updateAudited(tx, medicalCertificates, existing.id, existing.rowVersion, {
                personId,
                facility,
                examinedOn
            });
            return;
        }
        await insertAudited(tx, medicalCertificates, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            caseId: place.caseId,
            personId,
            facility,
            examinedOn
        });
    }

    /** An examiner's result, typed, under the day's session. */
    async recordExam(tx: Tx, place: CasePlace, personId: string, answers: unknown, outcome?: string) {
        const parsed = examAnswersSchema.safeParse(answers);
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({
                    path: i.path.join('.'),
                    code: 'invalid',
                    message: i.message
                }))
            });
        const exam = parsed.data;
        // `competency.recordExam:passed` on a workflow's way forward: a failed exam must not take it
        if ((outcome === 'passed' && !exam.passed) || (outcome === 'failed' && exam.passed))
            throw notEligible(say('competency.rule.examOutcome'));
        const session = await this.session(tx, place, exam.heldOn);
        const [last] = await tx
            .select({ n: sql<number>`coalesce(max(${examResults.attempt}), 0)::int` })
            .from(examResults)
            .where(eq(examResults.caseId, place.caseId));
        await insertAudited(tx, examResults, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            sessionId: session,
            caseId: place.caseId,
            personId,
            attempt: (last?.n ?? 0) + 1,
            theory: exam.theory ?? null,
            practical: exam.practical ?? null,
            passed: exam.passed
        });
        return { exam: { passed: exam.passed } };
    }

    private async session(tx: Tx, place: CasePlace, heldOn: string): Promise<string> {
        const where = and(eq(examSessions.handlingUnitId, place.handlingUnitId), eq(examSessions.heldOn, heldOn));
        const [existing] = await tx.select({ id: examSessions.id }).from(examSessions).where(where);
        if (existing) return existing.id;
        const made = await insertAudited(tx, examSessions, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            heldOn
        });
        return made.id;
    }

    // ---- a first licence ----

    /** The licence as it waits for the national platform. Run again (a step taken twice), it is the same licence. */
    async createPending(tx: Tx, place: CasePlace, input: { person: string; grade: string }) {
        const grade = await this.grade(tx, place.regionId, input.grade);
        const [found] = await tx
            .select()
            .from(driverLicences)
            .where(and(eq(driverLicences.caseId, place.caseId), sql`${driverLicences.status} <> 'voided'`));
        // a request corrected while it waited: the licence must be the one that was checked and approved
        const same =
            found &&
            found.personId === input.person &&
            (
                await tx
                    .select({ id: licenceGrades.id })
                    .from(licenceGrades)
                    .where(and(eq(licenceGrades.licenceId, found.id), eq(licenceGrades.gradeTypeId, grade.id)))
            ).length > 0;
        if (found && !same) {
            if (found.status !== 'pending_national')
                throw new ConflictError('invalid_transition', { detail: 'This case has already made a licence.' });
            await updateAudited(tx, driverLicences, found.id, found.rowVersion, {
                status: 'voided',
                voidReason: 'request_changed'
            });
        }
        const existing = same ? found : undefined;
        if (!existing) {
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`competency.licence:${input.person}:${grade.id}`}, 0))`
            );
            if (await this.alreadyHas(tx, input.person, grade.id, addisDay()))
                throw notEligible(say('competency.rule.alreadyHeld'));
        }
        const licence =
            existing ??
            (await insertAudited(tx, driverLicences, {
                regionId: place.regionId,
                handlingUnitId: place.handlingUnitId,
                personId: input.person,
                caseId: place.caseId
            }));
        if (!existing)
            await insertAudited(tx, licenceGrades, {
                regionId: place.regionId,
                handlingUnitId: place.handlingUnitId,
                licenceId: licence.id,
                gradeTypeId: grade.id
            });
        await emit(tx, 'licence.national-requested.v1', {
            caseId: place.caseId,
            licenceId: licence.id,
            kind: 'new'
        });
        return { licence: { id: licence.id } };
    }

    private licenceIdOf(facts: Readonly<Record<string, unknown>>, key: 'licence' | 'renewal'): string {
        const id = (facts[key] as { id?: unknown; licenceId?: unknown } | undefined)?.[
            key === 'licence' ? 'id' : 'licenceId'
        ];
        if (typeof id !== 'string')
            throw new ConflictError('contract_unmet', { detail: `The case has no ${key} to act on.` });
        return id;
    }

    private async row(tx: Tx, id: string): Promise<LicenceRow> {
        const [licence] = await tx.select().from(driverLicences).where(eq(driverLicences.id, id));
        if (!licence) throw new NotFoundError();
        return licence;
    }

    /** Accepted nationally: it is a licence now, temporary for two years (Art. 15(2)), with its number. */
    async activate(tx: Tx, place: CasePlace, facts: Readonly<Record<string, unknown>>, answer: unknown) {
        const given = nationalAnswerSchema.parse(answer);
        const licence = await this.row(tx, this.licenceIdOf(facts, 'licence'));
        if (licence.status === 'active') return { licence: { id: licence.id, number: licence.number } };
        const issuedOn = addisDay();
        // the national platform's number when it issues one; the region's counter until it does (architecture.md §15)
        const number = given.licenceNumber ?? (await nextNumber(tx, LICENCE_COUNTER, place.handlingUnitId)).number;
        await updateAudited(tx, driverLicences, licence.id, licence.rowVersion, {
            status: 'active',
            number,
            issuedOn,
            validUntil: temporaryValidUntil(issuedOn),
            nationalReference: given.reference ?? null
        });
        return { licence: { id: licence.id, number } };
    }

    /** Refused nationally: nothing was ever a licence. The record stays, with why. */
    async voidPending(tx: Tx, facts: Readonly<Record<string, unknown>>, answer: unknown) {
        const given = nationalAnswerSchema.parse(answer);
        const id = (facts.licence as { id?: unknown } | undefined)?.id;
        // a renewal has no pending record, and the licence never changed. Its next approval is a new decision for the platform
        if (typeof id !== 'string') {
            const renewal = facts.renewal as { attempt?: number } | undefined;
            return renewal ? { renewal: { ...renewal, attempt: (renewal.attempt ?? 0) + 1 } } : {};
        }
        const licence = await this.row(tx, id);
        if (licence.status === 'pending_national')
            await updateAudited(tx, driverLicences, licence.id, licence.rowVersion, {
                status: 'voided',
                voidReason: given.reason ?? 'case_closed'
            });
        return { licence: null };
    }

    // ---- a renewal ----

    /** What a renewal is, by the holder's age and how late it is (Art. 19). Nothing changes yet. */
    async checkRenewal(
        tx: Tx,
        place: CasePlace,
        input: { licence: string; medicalFacility: string; medicalExaminedOn: string; grade?: string; expiry?: string }
    ) {
        const today = addisDay();
        const licence = await this.row(tx, input.licence);
        if (licence.status !== 'active' || !licence.validUntil) throw notEligible(say('competency.rule.notRenewable'));
        // class R: the region reads a licence, its office's subtree writes it. The worker, which applies an accepted renewal, can't
        // check that, so it is checked here. Another office needs a transfer first.
        const [office] = await tx
            .select({ path: orgUnits.path })
            .from(orgUnits)
            .where(eq(orgUnits.id, place.handlingUnitId));
        const path = licence.handlingOrgPath;
        if (!office || (path !== office.path && !path.startsWith(`${office.path}.`)))
            throw notEligible(say('competency.rule.otherOffice'));
        // the fee was worked out from what the form said when it was filed: a later expiry would hide the penalty, a lesser grade lower it
        if (input.expiry !== undefined && input.expiry !== licence.validUntil)
            throw notEligible(say('competency.rule.renewalFacts'));
        if (input.grade !== undefined) {
            const held = await tx
                .select({ key: licenceGradeTypes.key })
                .from(licenceGrades)
                .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, licenceGrades.gradeTypeId))
                .where(eq(licenceGrades.licenceId, licence.id));
            if (!held.some((g) => g.key === input.grade)) throw notEligible(say('competency.rule.renewalFacts'));
        }
        const window = await this.settings.value<number>(tx, place.handlingUnitId, RENEWAL_WINDOW_SETTING);
        if (!renewalIsOpen(licence.validUntil, window, today))
            throw notEligible(say('competency.rule.tooEarly', { months: window }));
        const months = await this.settings.value<number>(tx, place.handlingUnitId, MEDICAL_MONTHS_SETTING);
        if (!medicalIsCurrent(input.medicalExaminedOn, months, today))
            throw notEligible(say('competency.rule.medical', { months }));
        const terms = renewalTerms(
            { validUntil: licence.validUntil },
            await this.birthDate(tx, place, licence.personId, 'licence renewal term'),
            today
        );
        await this.recordMedical(tx, place, licence.personId, input.medicalFacility, input.medicalExaminedOn);
        return {
            personId: licence.personId,
            renewal: {
                licenceId: licence.id,
                // what it renews: a second case on the same licence must not add a second term
                fromValidUntil: licence.validUntil,
                ...terms,
                temporary: licence.kind === 'temporary'
            }
        };
    }

    async requestRenewal(tx: Tx, place: CasePlace, facts: Readonly<Record<string, unknown>>) {
        await emit(tx, 'licence.national-requested.v1', {
            caseId: place.caseId,
            licenceId: this.licenceIdOf(facts, 'renewal'),
            kind: 'renewal',
            attempt: (facts.renewal as { attempt?: number }).attempt ?? 0
        });
    }

    /** Accepted nationally: the new term. A temporary licence becomes permanent here (Art. 15(3)). */
    async renew(tx: Tx, place: CasePlace, facts: Readonly<Record<string, unknown>>, answer: unknown) {
        const given = nationalAnswerSchema.parse(answer);
        const licence = await this.row(tx, this.licenceIdOf(facts, 'renewal'));
        const today = addisDay();
        if (!licence.validUntil)
            throw new ConflictError('contract_unmet', { detail: 'The licence has no term to renew.' });
        // another case renewed it since this one was checked: its term has been given, and terms never stack
        if ((facts.renewal as { fromValidUntil?: string }).fromValidUntil !== licence.validUntil)
            return { licence: { id: licence.id, number: licence.number } };
        const terms = renewalTerms(
            { validUntil: licence.validUntil },
            await this.birthDate(tx, place, licence.personId, 'licence renewal term'),
            today
        );
        await updateAudited(tx, driverLicences, licence.id, licence.rowVersion, {
            kind: 'permanent',
            validUntil: terms.validUntil,
            issuedOn: today,
            ...(given.reference ? { nationalReference: given.reference } : {})
        });
        const held = await tx.select().from(licenceGrades).where(eq(licenceGrades.licenceId, licence.id));
        for (const grade of held)
            if (!grade.permanentSince)
                await updateAudited(tx, licenceGrades, grade.id, grade.rowVersion, { permanentSince: today });
        return { licence: { id: licence.id, number: licence.number } };
    }

    // ---- the card and the printer ----

    /** The licence's card, signed like any document. A renewal's replaces the last one: its QR says superseded. */
    async issueCard(tx: Tx, place: CasePlace, facts: Readonly<Record<string, unknown>>) {
        const licence = await this.row(tx, this.licenceIdOf(facts, 'licence'));
        const language = currentContext()?.language ?? 'am';
        if (!licence.number || !licence.issuedOn || !licence.validUntil)
            throw new ConflictError('contract_unmet', { detail: 'The licence is not active yet.' });
        const [holder] = await tx.select().from(persons).where(eq(persons.id, licence.personId));
        if (!holder) throw new NotFoundError();
        const grades = await tx
            .select({ key: licenceGradeTypes.key, name: licenceGradeTypes.name })
            .from(licenceGrades)
            .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, licenceGrades.gradeTypeId))
            .where(eq(licenceGrades.licenceId, licence.id));
        const issued = await this.documents.reissue(tx, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            templateKey: LICENCE_CARD_TEMPLATE,
            language,
            number: licence.number,
            caseId: place.caseId,
            subject: { table: 'competency.driver_licences', id: licence.id },
            data: {
                number: licence.number,
                holderName: fullName(holder.givenNameAm, holder.fatherNameAm, holder.grandfatherNameAm),
                // not printed yet: what a document says is stored in clear, and a birth date is kept encrypted (ADR-0047)
                birthDate: null,
                grades: grades.map((g) => ({ grade: g.key, name: g.name })),
                issuedOn: licence.issuedOn,
                validUntil: licence.validUntil,
                photo: null
            }
        });
        const known = (facts.documents ?? {}) as Record<string, string>;
        return { documents: { ...known, [LICENCE_CARD_TEMPLATE]: issued.id } };
    }

    /** On the office's open batch: the region prints in batches. */
    async addToPrintBatch(tx: Tx, place: CasePlace, facts: Readonly<Record<string, unknown>>) {
        const licenceId = this.licenceIdOf(facts, 'licence');
        const open = and(
            eq(licencePrintBatches.handlingUnitId, place.handlingUnitId),
            eq(licencePrintBatches.status, 'open')
        );
        // locked, as sending locks it: a licence never lands on a batch already on its way to the printer
        const [batch] = await tx
            .select({ id: licencePrintBatches.id })
            .from(licencePrintBatches)
            .where(open)
            .for('update');
        const batchId =
            batch?.id ??
            (
                await insertAudited(tx, licencePrintBatches, {
                    regionId: place.regionId,
                    handlingUnitId: place.handlingUnitId
                })
            ).id;
        const [already] = await tx
            .select({ id: licencePrintBatchItems.id })
            .from(licencePrintBatchItems)
            .where(and(eq(licencePrintBatchItems.batchId, batchId), eq(licencePrintBatchItems.licenceId, licenceId)));
        if (!already)
            await insertAudited(tx, licencePrintBatchItems, {
                regionId: place.regionId,
                handlingUnitId: place.handlingUnitId,
                batchId,
                licenceId
            });
        return { printBatch: { id: batchId } };
    }

    // ---- the register ----

    private async views(tx: Tx, rows: readonly LicenceRow[]): Promise<Licence[]> {
        if (rows.length === 0) return [];
        const ids = rows.map((r) => r.id);
        const grades = await tx
            .select({
                licenceId: licenceGrades.licenceId,
                key: licenceGradeTypes.key,
                name: licenceGradeTypes.name,
                permanentSince: licenceGrades.permanentSince
            })
            .from(licenceGrades)
            .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, licenceGrades.gradeTypeId))
            .where(inArray(licenceGrades.licenceId, ids));
        const holders = await tx
            .select()
            .from(persons)
            .where(
                inArray(
                    persons.id,
                    rows.map((r) => r.personId)
                )
            );
        const units = await tx
            .select({ id: orgUnits.id, code: orgUnits.code, name: orgUnits.name })
            .from(orgUnits)
            .where(
                inArray(
                    orgUnits.id,
                    rows.map((r) => r.handlingUnitId)
                )
            );
        return rows.map((r) => {
            const holder = holders.find((p) => p.id === r.personId);
            return licenceSchema.parse({
                id: r.id,
                number: r.number,
                status: r.status,
                kind: r.kind,
                personId: r.personId,
                holder: {
                    am: holder
                        ? {
                              given: holder.givenNameAm,
                              father: holder.fatherNameAm,
                              grandfather: holder.grandfatherNameAm
                          }
                        : null,
                    en:
                        holder?.givenNameEn && holder.fatherNameEn
                            ? {
                                  given: holder.givenNameEn,
                                  father: holder.fatherNameEn,
                                  grandfather: holder.grandfatherNameEn
                              }
                            : null
                },
                grades: grades
                    .filter((g) => g.licenceId === r.id)
                    .map((g) => ({ key: g.key, name: g.name, permanentSince: g.permanentSince })),
                handlingUnit: units.find((u) => u.id === r.handlingUnitId) ?? {
                    id: r.handlingUnitId,
                    code: '',
                    name: {}
                },
                issuedOn: r.issuedOn,
                validUntil: r.validUntil,
                nationalReference: r.nationalReference,
                caseId: r.caseId,
                version: r.rowVersion
            });
        });
    }

    async list(tx: Tx, query: { personId?: string; status?: LicenceRow['status']; number?: string; limit: number }) {
        const where: SQL[] = [];
        if (query.personId) where.push(eq(driverLicences.personId, query.personId));
        if (query.status) where.push(eq(driverLicences.status, query.status));
        if (query.number) where.push(like(driverLicences.number, `${query.number.replace(/[%_\\]/g, '\\$&')}%`));
        const rows = await tx
            .select()
            .from(driverLicences)
            .where(where.length ? and(...where) : undefined)
            .orderBy(sql`${driverLicences.createdAt} desc`)
            .limit(query.limit);
        return { items: await this.views(tx, rows) };
    }

    async get(tx: Tx, id: string): Promise<Licence> {
        const views = await this.views(tx, [await this.row(tx, id)]);
        const view = views[0];
        if (!view) throw new NotFoundError();
        return view;
    }

    /** Licences for a form's lookup: active ones, by number or by whoever holds them (the register's own folded name search). */
    async searchForLookup(tx: Tx, q: string, limit: number) {
        const needle = q.replace(/[%_\\]/g, '\\$&');
        const holders = (await this.persons.search(tx, q, limit)).map((p) => p.id);
        const rows = await tx
            .select()
            .from(driverLicences)
            .where(
                and(
                    eq(driverLicences.status, 'active'),
                    or(
                        like(driverLicences.number, `${needle}%`),
                        holders.length ? inArray(driverLicences.personId, holders) : undefined
                    )
                )
            )
            .limit(limit);
        return this.views(tx, rows);
    }

    async byIds(tx: Tx, ids: readonly string[]) {
        if (ids.length === 0) return [];
        return this.views(
            tx,
            await tx
                .select()
                .from(driverLicences)
                .where(inArray(driverLicences.id, [...ids]))
        );
    }

    gradeText = textIn;

    // ---- the worker's view of a request ----

    /** What the national platform is asked: who, for which grades. No Fayda number, no birth date (SEC-PD: only what it needs). */
    async nationalRequest(tx: Tx, licenceId: string) {
        const licence = await this.row(tx, licenceId);
        const [holder] = await tx.select().from(persons).where(eq(persons.id, licence.personId));
        if (!holder) throw new NotFoundError();
        const [unit] = await tx
            .select({ code: orgUnits.code })
            .from(orgUnits)
            .where(eq(orgUnits.id, licence.handlingUnitId));
        const grades = await tx
            .select({ key: licenceGradeTypes.key })
            .from(licenceGrades)
            .innerJoin(licenceGradeTypes, eq(licenceGradeTypes.id, licenceGrades.gradeTypeId))
            .where(eq(licenceGrades.licenceId, licence.id));
        return {
            licenceId: licence.id,
            personId: licence.personId,
            name: fullName(holder.givenNameAm, holder.fatherNameAm, holder.grandfatherNameAm),
            birthYear: holder.birthYear,
            sex: holder.sex,
            officeCode: unit?.code ?? '',
            grades: grades.map((g) => g.key),
            number: licence.number,
            nationalReference: licence.nationalReference
        };
    }
}

export type EnrolmentCreate = z.infer<typeof enrolmentCreateSchema>;
