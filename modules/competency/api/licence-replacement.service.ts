/**
 * The replacement of a driver licence's card, DVC-19 (Proclamation 1074/2018 Art. 18, task 1.6e): what a request must meet, checked
 * when it is filed and again before the card is issued. The licence is active and no restriction holds on it (task 1.6c), its term
 * has not run out (an expired licence is renewed, and the renewal gives the card), and it is the office's to act on (class R: its
 * office's subtree). A lost or stolen card needs the police letter; a damaged or outdated one is handed in at the desk.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';
import { orgUnits } from '@itrms/kernel/tables';
import { cases } from '@itrms/workflow/api';

import {
    addisDay,
    CARD_GONE,
    LICENCE_REPLACEMENT_REASONS,
    type LicenceReplacementInput,
    type LicenceReplacementReason
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { driverLicences } from './competency.table';
import { restrictedOn } from './licence-restrictions';
import type { CasePlace } from './licences.service';
import { refuse, type Refusal } from './paper-records';

type Words = keyof typeof am;

const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

const isReason = (v: string): v is LicenceReplacementReason =>
    (LICENCE_REPLACEMENT_REASONS as readonly string[]).includes(v);

@Injectable()
export class LicenceReplacementService {
    /** What makes a replacement acceptable; nothing is written. Its facts name the licence the card is for. */
    async check(tx: Tx, place: CasePlace, input: LicenceReplacementInput) {
        const errors: Refusal[] = [];
        if (!z.uuid().safeParse(input.licence).success)
            return refuse([{ path: 'licence', code: 'invalid', message: say('competency.rule.notReplaceable') }]);
        const [licence] = await tx.select().from(driverLicences).where(eq(driverLicences.id, input.licence));
        if (!licence) throw new NotFoundError();
        const today = addisDay();
        if (licence.status !== 'active' || !licence.number)
            errors.push({ path: 'licence', code: 'not_active', message: say('competency.rule.notReplaceable') });
        else if (await restrictedOn(tx, licence.id, today))
            errors.push({ path: 'licence', code: 'restricted', message: say('competency.rule.licenceSuspended') });
        else if (!licence.validUntil || licence.validUntil < today)
            errors.push({ path: 'licence', code: 'expired', message: say('competency.rule.replaceExpired') });
        // class R: the licence's office, or one above it, gives its card
        const [office] = await tx
            .select({ path: orgUnits.path })
            .from(orgUnits)
            .where(eq(orgUnits.id, place.handlingUnitId));
        const path = licence.handlingOrgPath;
        if (!office || (path !== office.path && !path.startsWith(`${office.path}.`)))
            errors.push({ path: 'licence', code: 'other_office', message: say('competency.rule.otherOffice') });

        const reason = isReason(input.reason) ? input.reason : null;
        if (!reason)
            errors.push({ path: 'reason', code: 'invalid', message: say('competency.rule.replacementReason') });
        // Art. 18: a card that is gone has the police letter; one still in hand is handed in
        else if (CARD_GONE.includes(reason)) {
            if (!Array.isArray(input.policeReport) || input.policeReport.length === 0)
                errors.push({ path: 'policeReport', code: 'required', message: say('competency.rule.policeLetter') });
        } else if (input.oldCardHandedIn !== true)
            errors.push({ path: 'oldCardHandedIn', code: 'required', message: say('competency.rule.oldCardHandedIn') });

        // one replacement at a time: another open one would print the card twice
        const [other] = await tx
            .select({ id: cases.id })
            .from(cases)
            .where(
                and(
                    isNull(cases.closedAt),
                    ne(cases.id, place.caseId),
                    sql`${cases.facts} ? 'replacement'`,
                    sql`${cases.facts} -> 'licence' ->> 'id' = ${licence.id}`
                )
            )
            .limit(1);
        if (other)
            errors.push({ path: 'licence', code: 'open_replacement', message: say('competency.rule.openReplacement') });

        if (errors.length > 0 || !reason) return refuse(errors);
        return {
            licence: { id: licence.id, number: licence.number },
            // the old card's serial, kept with the case: a lost or stolen card is what the police may meet
            replacement: { reason, oldCardSerial: licence.cardSerial }
        };
    }
}
