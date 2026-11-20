/**
 * The suspension and cancellation record, DVC-21 (ADR-0064 §6, task 1.6c): what a record must meet, and the step that puts it on the
 * register once a second person has approved it against the authority's decision. ITRMS records a decision, it never makes one. A
 * suspension holds from its first to its last day and blocks the licence's other services; a cancellation ends the licence and revokes
 * its card document, whose QR then reports it revoked. The licence's own office, or one above it, records it: the office that wrote the
 * licence and issued its card.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import { insertAudited, updateAudited, type Tx } from '@itrms/kernel/db';
import { ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { orgUnits } from '@itrms/kernel/tables';
import { documentTemplates, issuedDocuments, revokeDocument } from '@itrms/documents/api';

import {
    addisDay,
    AUTHORITY_REFERENCE_MAX,
    LICENCE_CARD_TEMPLATE,
    RESTRICTION_AUTHORITIES,
    RESTRICTION_KINDS,
    type LicenceRestrictionInput,
    type RestrictionAuthority,
    type RestrictionKind
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { driverLicences, licenceRestrictions } from './competency.table';
import { actForHandlingOffice } from './handling-office';
import type { CasePlace } from './licences.service';
import { refuse, type Refusal } from './paper-records';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;

/** A refusal in the language of the person acting: this is what they read at the desk. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

const isKind = (v: string): v is RestrictionKind => (RESTRICTION_KINDS as readonly string[]).includes(v);
const isAuthority = (v: string): v is RestrictionAuthority =>
    (RESTRICTION_AUTHORITIES as readonly string[]).includes(v);

/** The record as the register will keep it. */
interface Recorded {
    licence: typeof driverLicences.$inferSelect;
    kind: RestrictionKind;
    authority: RestrictionAuthority;
    authorityReference: string;
    decidedOn: string;
    startsOn: string;
    endsOn: string | null;
}

@Injectable()
export class LicenceRestrictionService {
    /** What makes a record acceptable, on the server; nothing is written. */
    async check(tx: Tx, place: CasePlace, input: LicenceRestrictionInput) {
        const recorded = await this.recorded(tx, place, input);
        return { licenceRestriction: { licenceId: recorded.licence.id, kind: recorded.kind } };
    }

    /**
     * The second person's step: the restriction joins the register; a cancellation ends the licence and revokes its card. Checked again
     * under the licence's row lock, so two records of one licence take turns and the second sees the first.
     */
    async record(tx: Tx, at: CasePlace, input: LicenceRestrictionInput, facts: Facts) {
        const place = await actForHandlingOffice(tx, at);
        const approvedBy = place.ctx.userId;
        if (!approvedBy) throw new ForbiddenError();
        await tx
            .select({ id: driverLicences.id })
            .from(driverLicences)
            .where(eq(driverLicences.id, input.licence))
            .for('update');
        const recorded = await this.recorded(tx, place, input);
        const { licence } = recorded;
        const restriction = await insertAudited(tx, licenceRestrictions, {
            regionId: licence.regionId,
            handlingUnitId: licence.handlingUnitId,
            licenceId: licence.id,
            caseId: place.caseId,
            kind: recorded.kind,
            authority: recorded.authority,
            authorityReference: recorded.authorityReference,
            decidedOn: recorded.decidedOn,
            startsOn: recorded.startsOn,
            endsOn: recorded.endsOn,
            approvedBy,
            approvedAt: new Date()
        });
        if (recorded.kind === 'cancellation') {
            await updateAudited(tx, driverLicences, licence.id, licence.rowVersion, { status: 'cancelled' });
            await this.revokeCards(tx, licence.id);
        }
        const known = (facts.licenceRestriction ?? {}) as Record<string, unknown>;
        return { licenceRestriction: { ...known, id: restriction.id, licenceId: licence.id, kind: recorded.kind } };
    }

    /** The licence's card documents that stand, revoked: their QR says so from now on. */
    private async revokeCards(tx: Tx, licenceId: string) {
        const standing = await tx
            .select({ document: issuedDocuments })
            .from(issuedDocuments)
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(
                and(
                    eq(documentTemplates.key, LICENCE_CARD_TEMPLATE),
                    eq(issuedDocuments.subjectId, licenceId),
                    isNull(issuedDocuments.supersededBy),
                    isNull(issuedDocuments.revokedAt)
                )
            );
        for (const { document } of standing) await revokeDocument(tx, document, 'licence_cancelled');
    }

    /** The request's answers checked and folded as the register keeps them; every refusal at once, on its box. */
    private async recorded(tx: Tx, place: CasePlace, input: LicenceRestrictionInput): Promise<Recorded> {
        const errors: Refusal[] = [];
        const today = addisDay();
        const [licence] = await tx.select().from(driverLicences).where(eq(driverLicences.id, input.licence));
        if (!licence) throw new NotFoundError();
        // an active licence only: a cancelled one has ended, one the national platform has not accepted is nobody's yet
        if (licence.status === 'cancelled')
            errors.push({ path: 'licence', code: 'cancelled', message: say('competency.rule.licenceCancelled') });
        else if (licence.status !== 'active')
            errors.push({ path: 'licence', code: 'not_active', message: say('competency.rule.notRestrictable') });
        // class R: the licence's office, or one above it, writes its record (and holds its card)
        const [office] = await tx
            .select({ path: orgUnits.path })
            .from(orgUnits)
            .where(eq(orgUnits.id, place.handlingUnitId));
        const path = licence.handlingOrgPath;
        if (!office || (path !== office.path && !path.startsWith(`${office.path}.`)))
            errors.push({ path: 'licence', code: 'other_office', message: say('competency.rule.otherOffice') });

        const kind = isKind(input.kind) ? input.kind : null;
        if (!kind) errors.push({ path: 'kind', code: 'invalid', message: say('competency.rule.restrictionKind') });
        const authority = isAuthority(input.authority) ? input.authority : null;
        if (!authority)
            errors.push({ path: 'authority', code: 'invalid', message: say('competency.rule.restrictionAuthority') });
        const authorityReference = (input.authorityReference ?? '').trim();
        if (authorityReference.length < 1 || authorityReference.length > AUTHORITY_REFERENCE_MAX)
            errors.push({
                path: 'authorityReference',
                code: 'invalid',
                message: say('competency.rule.authorityReference')
            });
        if (input.decidedOn > today)
            errors.push({ path: 'decidedOn', code: 'in_future', message: say('competency.rule.notInFuture') });
        if (input.startsOn < input.decidedOn)
            errors.push({
                path: 'startsOn',
                code: 'before_decision',
                message: say('competency.rule.startsBeforeDecision')
            });
        const endsOn = input.endsOn?.trim() ? input.endsOn : null;
        if (kind === 'suspension' && (!endsOn || endsOn < input.startsOn))
            errors.push({ path: 'endsOn', code: 'invalid', message: say('competency.rule.suspensionEnds') });
        if (kind === 'cancellation' && endsOn)
            errors.push({ path: 'endsOn', code: 'invalid', message: say('competency.rule.cancellationEnds') });

        if (errors.length > 0 || !kind || !authority) return refuse(errors);
        return {
            licence,
            kind,
            authority,
            authorityReference,
            decidedOn: input.decidedOn,
            startsOn: input.startsOn,
            endsOn: kind === 'suspension' ? endsOn : null
        };
    }
}
