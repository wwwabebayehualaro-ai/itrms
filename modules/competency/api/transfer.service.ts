/**
 * The ownership transfer, DVC-13 (task 1.4b): what a request must meet, the committee's valuation, the letters to the other
 * offices, the papers that come back, and the step that changes the owners in the register and issues the new libre. The register
 * is the vehicles slice's (VehicleRegistry); these steps call its commands inside the transition's transaction, so a step that
 * fails leaves nothing, and each step run again returns what it made. The valuation is the committee's: nothing here works out a
 * tax or a duty from it.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { currentContext } from '@itrms/kernel/context';
import { insertAudited, updateAudited, type Tx } from '@itrms/kernel/db';
import { ConflictError, ValidationError } from '@itrms/kernel/errors';
import { nextNumber, requireCounter } from '@itrms/kernel/numbering';
import { SettingsService } from '@itrms/kernel/settings';
import { DocumentsService, documentTemplates, issuedDocuments, revokeDocument } from '@itrms/documents/api';
import { OrganisationsService, PersonsService } from '@itrms/parties/api';
import { plateAssignments, vehicles, VehicleRegistry, VehiclesService } from '@itrms/vehicles/api';
import { REGISTRATION_CERTIFICATE_COUNTER } from '@itrms/vehicles/contracts';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import {
    addisDay,
    DEFAULT_TRANSFER_LETTER_DAYS,
    evidenceEntrySchema,
    lettersEntrySchema,
    MAX_VALUATION_BIRR,
    REGISTRATION_CERTIFICATE_TEMPLATE,
    TRANSFER_ACQUIRED_BY,
    TRANSFER_LETTER_COUNTER,
    TRANSFER_LETTER_ENFORCED_SETTING,
    TRANSFER_LETTER_TEMPLATES,
    TRANSFER_LETTER_VALID_DAYS_SETTING,
    valuationEntrySchema,
    type TransferAcquiredBy,
    type TransferLetterKind
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { daysAfter } from './bolo-validity';
import { ownershipTransfers } from './competency.table';
import { actForCase, actForHandlingOffice, claimedElsewhere, lockVehicleClaim } from './handling-office';
import type { CasePlace } from './licences.service';
import { ownersOf, VehicleRegistrationService } from './registration.service';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;
type Transfer = typeof ownershipTransfers.$inferSelect;
type Ref = { kind: 'person' | 'organisation'; id: string };

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

type Refusal = { path: string; key: Words; code?: string };

const refuseAll = (refusals: readonly Refusal[]): never => {
    throw new ValidationError('validation_failed', {
        errors: refusals.map((r) => ({ path: r.path, code: r.code ?? 'invalid', message: say(r.key) }))
    });
};

const refuse = (path: string, code: string, key: Words): never => refuseAll([{ path, code, key }]);

/** An entry the step's form let through that its schema does not: a 422 with the fields, never a 500. */
function parseEntry<S extends z.ZodType>(schema: S, answers: unknown): z.output<S> {
    const parsed = schema.safeParse(answers ?? {});
    if (parsed.success) return parsed.data;
    throw new ValidationError('validation_failed', {
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: 'invalid', message: i.message }))
    });
}

const factObject = (facts: Facts, key: string): Record<string, unknown> | undefined => {
    const value = facts[key];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
};

const missingFact = (key: string) =>
    new ConflictError('contract_unmet', { detailKey: 'competency.errors.registration_missing_fact', params: { key } });

const refsSchema = z.array(z.object({ kind: z.enum(['person', 'organisation']), id: z.uuid() }));

const words = (key: string): { am: string; en: string } => ({
    am: (vehiclesAm as Record<string, string>)[key] ?? key,
    en: (vehiclesEn as Record<string, string>)[key] ?? key
});

/** Whole Birr as the committee gives it, in santim: a figure that is no whole Birr in range is refused where it was typed. */
function santim(path: string, birr: number): bigint {
    if (!Number.isSafeInteger(birr) || birr < 1 || birr > MAX_VALUATION_BIRR)
        return refuse(path, 'out_of_range', 'competency.rule.valuationAmount');
    return BigInt(birr) * 100n;
}

const isAcquiredBy = (value: string): value is TransferAcquiredBy =>
    (TRANSFER_ACQUIRED_BY as readonly string[]).includes(value);

/** The request's answers an effect reads, by contract path (see transfer.effects.ts). */
export type TransferInput = {
    /** the vehicle, picked from the register */
    vehicle: string;
    /** the buyers: one person or one organisation in each row */
    owners: unknown[];
    /** how they came by it */
    acquiredBy: string;
};

@Injectable()
export class OwnershipTransferService {
    constructor(
        @Inject(VehicleRegistry) private readonly registry: VehicleRegistry,
        @Inject(VehiclesService) private readonly vehicles: VehiclesService,
        @Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService,
        @Inject(DocumentsService) private readonly documents: DocumentsService,
        @Inject(SettingsService) private readonly settings: SettingsService,
        @Inject(PersonsService) private readonly persons: PersonsService,
        @Inject(OrganisationsService) private readonly organisations: OrganisationsService
    ) {}

    // ---- filing ----

    /**
     * What makes a transfer acceptable, checked on the server: the vehicle is on the register and handled by the office the case is
     * in, the buyers are on the register and are not the owners it has, the office can number the libre's certificate and its
     * letters, and no other open request claims the vehicle. Nothing is written. Whether the vehicle is encumbered is the
     * encumbrance check's (`vehicles.checkEncumbrances:ownership-transfer`), named beside this effect. Checked again on a case
     * that has facts, it refuses a vehicle whose owners changed since the filing.
     */
    async check(tx: Tx, place: CasePlace, input: TransferInput, facts: Facts = {}) {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicle));
        if (!vehicle || vehicle.status !== 'active')
            return refuse('vehicle', 'not_active', 'competency.rule.transferNotActive');
        if (vehicle.handlingUnitId !== place.handlingUnitId)
            return refuse('vehicle', 'other_office', 'competency.rule.transferOtherOffice');
        if (!isAcquiredBy(input.acquiredBy))
            return refuse('acquiredBy', 'invalid', 'competency.rule.transferAcquiredBy');
        const buyers = ownersOf(input.owners);
        let checked;
        try {
            checked = await this.registry.checkTransfer(tx, place.ctx, vehicle.id, buyers);
        } catch (error) {
            if (error instanceof ValidationError && error.errors?.some((e) => e.code === 'same_owners'))
                return refuse('owners', 'same_owners', 'competency.rule.transferSameOwners');
            throw error;
        }
        // a check made again (the letters step, a correction) finds the owners the filing saw: others since are a new request's
        // a correction to another vehicle is a fresh check
        const seen = factObject(facts, 'transfer');
        const saw = seen?.vehicleId === vehicle.id ? seen.sellerOwnershipId : undefined;
        if (typeof saw === 'string' && saw !== checked.openPeriodId)
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.owners_changed' });
        // the numbers come later and are never made up on the spot: an office with no series is told now, not after the fee
        await requireCounter(tx, REGISTRATION_CERTIFICATE_COUNTER, place.handlingUnitId);
        await requireCounter(tx, TRANSFER_LETTER_COUNTER, place.handlingUnitId);
        // two requests for one vehicle filed at the same moment: the second waits for the first's transaction, then sees its facts
        await lockVehicleClaim(tx, vehicle.id);
        if (
            await claimedElsewhere(tx, place.caseId, {
                vehicleId: vehicle.id,
                vinKey: checked.vinKey,
                makeKey: checked.makeKey
            })
        )
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.transferInOpenCase'),
                detailKey: 'competency.rule.transferInOpenCase'
            });
        const [plate] = await tx
            .select({ legacyUseCode: plateAssignments.legacyUseCode })
            .from(plateAssignments)
            .where(and(eq(plateAssignments.vehicleId, vehicle.id), isNull(plateAssignments.until)));
        // a commercial vehicle (plate code 3): its buyers register as business taxpayers
        const code3 = vehicle.use === 'commercial' || plate?.legacyUseCode === 3;
        return {
            vehicle: { id: vehicle.id },
            // the vehicle's id here is what the register's open-case lookup claims it by (migration 0084)
            transfer: {
                vehicleId: vehicle.id,
                sellerOwnershipId: checked.openPeriodId,
                sellers: checked.sellers,
                buyers,
                acquiredBy: input.acquiredBy,
                code3
            }
        };
    }

    // ---- the valuation ----

    /** The committee's value, and whether the vehicle is as its paper inspection says. Recorded again, it replaces the first. */
    async recordValuation(tx: Tx, at: CasePlace, facts: Facts, answers: unknown) {
        const place = await actForHandlingOffice(tx, at);
        const given = parseEntry(valuationEntrySchema, answers);
        if (!given.inspectionMatches)
            return refuse('inspectionMatches', 'not_matching', 'competency.rule.valuationNotMatching');
        const optional = (path: string, birr: number | undefined) => (birr === undefined ? null : santim(path, birr));
        const values = {
            purchasePriceSantim: optional('purchasePriceBirr', given.purchasePriceBirr),
            marketValueSantim: optional('marketValueBirr', given.marketValueBirr),
            contractValueSantim: optional('contractValueBirr', given.contractValueBirr),
            committeeValueSantim: santim('committeeValueBirr', given.committeeValueBirr)
        };
        const row = await this.rowOf(tx, place, facts);
        await updateAudited(tx, ownershipTransfers, row.id, row.rowVersion, {
            ...values,
            valuedOn: addisDay(),
            valuedBy: place.ctx.userId ?? null,
            inspectionNote: given.inspectionNote ?? null,
            // numeric(5,2): a percentage is no money, kept as the text the database rounds to two places
            depreciationPercent: given.depreciationPercent === undefined ? null : given.depreciationPercent.toFixed(2),
            valuers: given.valuers ?? null
        });
        return { valuation: { committeeValueSantim: values.committeeValueSantim.toString() } };
    }

    // ---- the letters ----

    /**
     * The letters to the other offices, numbered from the office's counter: the revenue office always, the justice office for a
     * sale or a gift (it authenticates the contract), the tax office for a code-3 vehicle. Each stands for the office's
     * `competency.transfer_letter_valid_days`. Run again, it returns the letters it issued.
     */
    async issueLetters(tx: Tx, at: CasePlace, facts: Facts, answers: unknown, caseNumber: number) {
        const place = await actForHandlingOffice(tx, at);
        const given = parseEntry(lettersEntrySchema, answers);
        const row = await this.rowOf(tx, place, facts);
        if (row.committeeValueSantim === null) throw missingFact('valuation');
        const needsJustice = row.acquiredBy === 'sale' || row.acquiredBy === 'gift';
        const refusals: Refusal[] = [];
        if (needsJustice && !given.justiceOffice)
            refusals.push({ path: 'justiceOffice', key: 'competency.rule.lettersJusticeOffice', code: 'required' });
        if (row.code3 && !given.taxOffice)
            refusals.push({ path: 'taxOffice', key: 'competency.rule.lettersTaxOffice', code: 'required' });
        if (refusals.length > 0) return refuseAll(refusals);

        const offices: Record<TransferLetterKind, string | undefined> = {
            revenue: given.revenueOffice,
            justice: needsJustice ? given.justiceOffice : undefined,
            tax: row.code3 ? given.taxOffice : undefined
        };
        const today = addisDay();
        const validUntil = daysAfter(today, await this.validDays(tx, place.handlingUnitId));
        const vehicle = await this.vehicles.get(tx, row.vehicleId);
        const known = factObject(facts, 'documents') ?? {};
        const issued: Record<string, string> = {};
        for (const kind of ['revenue', 'justice', 'tax'] as const) {
            const addressee = offices[kind];
            if (!addressee) continue;
            const templateKey = TRANSFER_LETTER_TEMPLATES[kind];
            const found = await this.standing(tx, templateKey, place.caseId);
            // a letter that expired is issued again with a new number and new days, the old one superseded (task 1.4b3);
            // one that still stands keeps its number, days and language: an officer reading in another language changes nothing
            const standing = found && found.validUntil >= today ? found : undefined;
            const number =
                standing?.number ?? (await nextNumber(tx, TRANSFER_LETTER_COUNTER, place.handlingUnitId)).number;
            const language = ((standing ?? found)?.language ?? currentContext()?.language) === 'en' ? 'en' : 'am';
            const sellers = vehicle.ownerships.find((o) => o.id === row.sellerOwnershipId)?.holders ?? [];
            const buyers = refsSchema.safeParse(factObject(facts, 'transfer')?.buyers);
            if (!buyers.success) throw missingFact('transfer');
            const letter = await this.documents.reissue(tx, {
                regionId: place.regionId,
                handlingUnitId: place.handlingUnitId,
                templateKey,
                language,
                number,
                caseId: place.caseId,
                subject: { table: 'workflow.cases', id: place.caseId },
                data: {
                    number,
                    issuedOn: standing ? standing.issuedOn : today,
                    validUntil: standing ? standing.validUntil : validUntil,
                    kind,
                    addressee,
                    caseNumber,
                    acquiredBy: words(`vehicles.acquiredBy.${row.acquiredBy}`),
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
                    sellers: sellers.map((h) => ({ name: h.name[language] || h.name.am })),
                    buyers: await this.namesOf(tx, buyers.data, language),
                    valuation: kind === 'revenue' ? this.valuationOf(row) : null
                }
            });
            issued[templateKey] = letter.id;
        }
        if (row.lettersIssuedOn === null)
            await updateAudited(tx, ownershipTransfers, row.id, row.rowVersion, { lettersIssuedOn: today });
        return { documents: { ...known, ...issued } };
    }

    // ---- the papers that came back ----

    /**
     * The authenticated contract (or the court's reference), the stamp duty receipt the revenue office gave and, for a code-3
     * vehicle, the tax registration. The days are real days: none in the future and none before the letters went out. The files
     * belong to the step's own submission, which keeps them.
     */
    async recordEvidence(tx: Tx, at: CasePlace, facts: Facts, answers: unknown) {
        const place = await actForHandlingOffice(tx, at);
        const given = parseEntry(evidenceEntrySchema, answers);
        const row = await this.rowOf(tx, place, facts);
        if (row.lettersIssuedOn === null) throw missingFact('letters');
        const refusals: Refusal[] = [];
        const contract = row.acquiredBy === 'sale' || row.acquiredBy === 'gift';
        if (contract && !given.contractReference)
            refusals.push({ path: 'contractReference', key: 'competency.rule.evidenceContract', code: 'required' });
        if (contract && !given.contractAuthenticatedOn)
            refusals.push({
                path: 'contractAuthenticatedOn',
                key: 'competency.rule.evidenceContract',
                code: 'required'
            });
        if ((row.acquiredBy === 'inheritance' || row.acquiredBy === 'court_order') && !given.courtReference)
            refusals.push({ path: 'courtReference', key: 'competency.rule.evidenceCourt', code: 'required' });
        if (row.code3 && !given.taxRegistrationReference)
            refusals.push({
                path: 'taxRegistrationReference',
                key: 'competency.rule.evidenceTaxRegistration',
                code: 'required'
            });
        const today = addisDay();
        // strict (the default): each paper is dated while a letter it answers stood, the contract the justice office's and the
        // receipt the revenue office's; the days the papers carry count, not the day they are recorded (task 1.4b3)
        const strict = await this.lettersBind(tx, place.handlingUnitId);
        for (const [path, day, kind] of [
            ['contractAuthenticatedOn', given.contractAuthenticatedOn, 'justice'],
            ['stampDutyPaidOn', given.stampDutyPaidOn, 'revenue']
        ] as const) {
            if (day === undefined) continue;
            if (day > today || day < row.lettersIssuedOn)
                refusals.push({ path, key: 'competency.rule.evidenceDate', code: 'out_of_range' });
            // a contract date on an inheritance or a court order answers no letter: the justice letter is for a sale or a gift
            else if (strict && (kind === 'revenue' || contract)) {
                const windows = await this.letterWindows(tx, TRANSFER_LETTER_TEMPLATES[kind], place.caseId);
                if (windows.length === 0) throw missingFact('letters');
                if (!windows.some((w) => day >= w.issuedOn && day <= w.validUntil))
                    refusals.push({ path, key: 'competency.rule.evidenceLetterExpired', code: 'letter_expired' });
            }
        }
        if (refusals.length > 0) return refuseAll(refusals);
        await updateAudited(tx, ownershipTransfers, row.id, row.rowVersion, {
            contractReference: given.contractReference ?? null,
            contractAuthenticatedOn: given.contractAuthenticatedOn ?? null,
            stampDutyReceipt: given.stampDutyReceipt,
            stampDutyPaidOn: given.stampDutyPaidOn,
            taxRegistrationReference: given.taxRegistrationReference ?? null,
            courtReference: given.courtReference ?? null,
            evidenceRecordedBy: place.ctx.userId ?? null,
            evidenceRecordedAt: new Date()
        });
        return {};
    }

    // ---- the transfer ----

    /**
     * The owners change in the register: the sellers' period ends today, the buyers' begins, the libre in force is cancelled and
     * its certificate revoked, and the buyers' libre is issued (no number until its booklet) with a new registration certificate
     * naming them. A vehicle whose owners changed since the request was filed is a 409. Run again it returns what it made.
     */
    async transfer(tx: Tx, at: CasePlace, facts: Facts, template: string | undefined) {
        const place = await actForHandlingOffice(tx, at);
        const templateKey = template || REGISTRATION_CERTIFICATE_TEMPLATE;
        const [locked] = await tx
            .select()
            .from(ownershipTransfers)
            .where(eq(ownershipTransfers.caseId, place.caseId))
            .for('update');
        if (!locked) throw missingFact('valuation');
        const known = factObject(facts, 'documents') ?? {};
        if (locked.transferredOn !== null && locked.newLibreId !== null) {
            const libre = (await this.vehicles.get(tx, locked.vehicleId)).libres.find(
                (l) => l.id === locked.newLibreId
            );
            const certificate = await this.standing(tx, templateKey, locked.newLibreId);
            return {
                libre: { id: locked.newLibreId, number: libre?.number ?? null, template: templateKey },
                documents: certificate ? { ...known, [templateKey]: certificate.id } : known
            };
        }
        if (locked.committeeValueSantim === null) throw missingFact('valuation');
        if (locked.evidenceRecordedAt === null) throw missingFact('evidence');
        const buyers = refsSchema.safeParse(factObject(facts, 'transfer')?.buyers);
        if (!buyers.success) throw missingFact('transfer');
        const since = addisDay();
        const moved = await this.registry.transferOwnershipWithLibre(
            tx,
            place.ctx,
            locked.vehicleId,
            { since, owners: buyers.data, acquiredBy: locked.acquiredBy, caseId: place.caseId },
            { ownershipId: locked.sellerOwnershipId }
        );
        // what the old owners held no longer holds: the QR of their libre's certificate says so
        if (moved.cancelled)
            for (const document of await this.standingOf(tx, moved.cancelled.id))
                await revokeDocument(tx, document, 'libre_ownership_transferred');
        const certificate = await this.registration.issueCertificate(tx, place, moved.libre, templateKey);
        await updateAudited(tx, ownershipTransfers, locked.id, locked.rowVersion, {
            buyerOwnershipId: moved.ownershipId,
            cancelledLibreId: moved.cancelled?.id ?? null,
            newLibreId: moved.libre.id,
            transferredOn: since,
            transferredBy: place.ctx.userId ?? null
        });
        return {
            libre: { id: moved.libre.id, number: moved.libre.number, template: templateKey },
            documents: { ...known, [templateKey]: certificate.id }
        };
    }

    // ---- a rejected case ----

    /** A case rejected before the transfer, or closed unpaid by its timeout: its letters no longer stand, and their QR says so. */
    async revokeLetters(tx: Tx, at: CasePlace) {
        const place = await actForCase(tx, at);
        const standing = await tx
            .select({ document: issuedDocuments })
            .from(issuedDocuments)
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(
                and(
                    inArray(documentTemplates.key, Object.values(TRANSFER_LETTER_TEMPLATES)),
                    eq(issuedDocuments.subjectId, place.caseId),
                    isNull(issuedDocuments.supersededBy),
                    isNull(issuedDocuments.revokedAt)
                )
            );
        for (const { document } of standing) await revokeDocument(tx, document, 'transfer_case_rejected');
        return {};
    }

    // ---- helpers ----

    /** The case's row, made with the facts the filing kept when the first step needs it. */
    private async rowOf(tx: Tx, place: CasePlace, facts: Facts): Promise<Transfer> {
        const [row] = await tx
            .select()
            .from(ownershipTransfers)
            .where(eq(ownershipTransfers.caseId, place.caseId))
            .for('update');
        if (row) return row;
        const transfer = factObject(facts, 'transfer');
        const { vehicleId, sellerOwnershipId, acquiredBy, code3 } = transfer ?? {};
        if (
            typeof vehicleId !== 'string' ||
            typeof sellerOwnershipId !== 'string' ||
            typeof acquiredBy !== 'string' ||
            !isAcquiredBy(acquiredBy)
        )
            throw missingFact('transfer');
        return insertAudited(tx, ownershipTransfers, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            caseId: place.caseId,
            vehicleId,
            sellerOwnershipId,
            acquiredBy,
            code3: code3 === true
        });
    }

    private valuationOf(row: Transfer) {
        if (row.committeeValueSantim === null || row.valuedOn === null) return null;
        const text = (v: bigint | null) => (v === null ? null : v.toString());
        return {
            valuedOn: row.valuedOn,
            committeeValueSantim: row.committeeValueSantim.toString(),
            purchasePriceSantim: text(row.purchasePriceSantim),
            marketValueSantim: text(row.marketValueSantim),
            contractValueSantim: text(row.contractValueSantim),
            depreciationPercent: row.depreciationPercent,
            valuers: row.valuers,
            inspectionNote: row.inspectionNote
        };
    }

    /** The buyers' names as a letter prints them, in the language of the letter. */
    private async namesOf(tx: Tx, refs: readonly Ref[], language: 'am' | 'en'): Promise<{ name: string }[]> {
        const people = new Map(
            (
                await this.persons.summaries(
                    tx,
                    refs.filter((r) => r.kind === 'person').map((r) => r.id)
                )
            ).map((p) => [p.id, p])
        );
        const bodies = new Map(
            (
                await this.organisations.summaries(
                    tx,
                    refs.filter((r) => r.kind === 'organisation').map((r) => r.id)
                )
            ).map((o) => [o.id, o])
        );
        const join = (n: { given: string; father: string; grandfather?: string | undefined }) =>
            [n.given, n.father, n.grandfather].filter(Boolean).join(' ');
        const names = refs.flatMap((r) => {
            if (r.kind === 'person') {
                const p = people.get(r.id);
                return p ? [join(language === 'en' && p.nameEn ? p.nameEn : p.nameAm)] : [];
            }
            const o = bodies.get(r.id);
            return o ? [o.name[language] || o.name.am || ''] : [];
        });
        return names.filter((n) => n !== '').map((name) => ({ name }));
    }

    /** The document of this template that stands for the subject, if there is one. */
    private async standing(tx: Tx, templateKey: string, subjectId: string) {
        const [found] = await tx
            .select({
                number: issuedDocuments.number,
                language: issuedDocuments.language,
                id: issuedDocuments.id,
                data: issuedDocuments.data
            })
            .from(issuedDocuments)
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(
                and(
                    eq(documentTemplates.key, templateKey),
                    eq(issuedDocuments.subjectId, subjectId),
                    isNull(issuedDocuments.supersededBy)
                )
            );
        if (!found) return undefined;
        const data = found.data as { issuedOn?: unknown; validUntil?: unknown };
        return {
            ...found,
            issuedOn: typeof data.issuedOn === 'string' ? data.issuedOn : addisDay(),
            validUntil: typeof data.validUntil === 'string' ? data.validUntil : addisDay()
        };
    }

    /** Every document that stands for the subject (the libre), whichever template it was issued from. */
    private async standingOf(tx: Tx, subjectId: string) {
        const rows = await tx
            .select({ document: issuedDocuments })
            .from(issuedDocuments)
            .where(
                and(
                    eq(issuedDocuments.subjectId, subjectId),
                    isNull(issuedDocuments.supersededBy),
                    isNull(issuedDocuments.revokedAt)
                )
            );
        return rows.map((r) => r.document);
    }

    /**
     * The days each letter of this kind stood for the case, superseded ones too (a letter issued again after it expired), never
     * one revoked. Read strictly: a letter without its days stood on none.
     */
    private async letterWindows(tx: Tx, templateKey: string, caseId: string) {
        const rows = await tx
            .select({ data: issuedDocuments.data })
            .from(issuedDocuments)
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(
                and(
                    eq(documentTemplates.key, templateKey),
                    eq(issuedDocuments.subjectId, caseId),
                    isNull(issuedDocuments.revokedAt)
                )
            );
        return rows.flatMap(({ data }) => {
            const { issuedOn, validUntil } = data as { issuedOn?: unknown; validUntil?: unknown };
            return typeof issuedOn === 'string' && typeof validUntil === 'string' ? [{ issuedOn, validUntil }] : [];
        });
    }

    /** Whether the letters' days bind the papers: on unless the region's setting is exactly `false`. */
    private async lettersBind(tx: Tx, unitId: string): Promise<boolean> {
        return (await this.settings.value<unknown>(tx, unitId, TRANSFER_LETTER_ENFORCED_SETTING)) !== false;
    }

    /** A number of days the office's settings give, or its default when the setting is not a positive whole number. */
    private async validDays(tx: Tx, unitId: string): Promise<number> {
        const value = await this.settings.value<unknown>(tx, unitId, TRANSFER_LETTER_VALID_DAYS_SETTING);
        return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : DEFAULT_TRANSFER_LETTER_DAYS;
    }
}
