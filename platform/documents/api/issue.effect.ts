/**
 * `documents.issue:<template>` (task 0.23a): named on a workflow's transition, it issues the case's document of that template
 * in the transition's transaction. Run twice (a step taken again), it is the same document. This slice can build the
 * application copy from the case's request; a work process with its own data (a licence, an exam) issues through
 * DocumentsService from its own effect.
 */
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';
import { ConflictError } from '@itrms/kernel/errors';
import { SettingsService } from '@itrms/kernel/settings';
import { formVersions, openFieldsFor, submissions } from '@itrms/forms/api';

import { ISSUE_DOCUMENT_EFFECT } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { addisDay, issueDocument } from './issue';
import { ethiopianDay, pick } from './render/format';

type Field = ReturnType<typeof openFieldsFor>[number];

/** What an answer prints as, in the document's language: an option's label, a day in the Ethiopian calendar, yes or no. */
function valueOf(field: Field, value: unknown, language: string): string {
    const raw = field as unknown as {
        type?: string;
        props?: { options?: unknown };
        data?: { dataSource?: { staticData?: unknown } };
    };
    const options = raw.props?.options ?? raw.data?.dataSource?.staticData;
    const words = language === 'en' ? en : am;
    const one = (v: unknown): string => {
        if (typeof v === 'boolean') return words[v ? 'documents.answer.yes' : 'documents.answer.no'];
        if (Array.isArray(options)) {
            const found = (options as { value?: unknown; label?: unknown }[]).find((o) => o.value === v);
            if (found) return pick(found.label, language);
        }
        if (raw.type === 'EthDate' || raw.type === 'DatePicker') return ethiopianDay(v, language);
        return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    };
    if (value === null || value === undefined) return '';
    return Array.isArray(value) ? value.map(one).filter(Boolean).join(', ') : one(value);
}

/**
 * The case's request as the applicant filed it, in the document's language. Only what anyone may be shown (the forms slice's
 * own rule): never a Sensitive field or one inside a Sensitive container, a removed field, or one a role's rule restricts.
 */
async function applicationCopy(
    tx: Tx,
    run: { caseId: string; caseNumber: number; config: Readonly<Record<string, unknown>> },
    language: string
) {
    const [request] = await tx
        .select({ answers: submissions.answers, document: formVersions.document, createdAt: submissions.createdAt })
        .from(submissions)
        .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
        .where(eq(submissions.caseId, run.caseId))
        .orderBy(asc(submissions.createdAt))
        .limit(1);
    if (!request) throw new ConflictError('contract_unmet', { detail: 'The case has no request to copy.' });
    return {
        caseNumber: run.caseNumber,
        serviceName: pick(run.config.serviceName, language),
        filedOn: addisDay(request.createdAt),
        fields: openFieldsFor(request.document, [], language).flatMap((field) =>
            field.id in request.answers
                ? [
                      {
                          label: pick((field as unknown as { label?: unknown }).label, language) || field.id,
                          value: valueOf(field, request.answers[field.id], language)
                      }
                  ]
                : []
        )
    };
}

@Injectable()
@Effect(ISSUE_DOCUMENT_EFFECT)
export class IssueDocumentEffect implements WorkflowEffect {
    constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

    async run({ tx, caseId, caseNumber, regionId, handlingUnitId, config, argument, facts }: EffectRun) {
        if (argument !== 'application-copy')
            throw new ConflictError('not_configured', {
                detail: `documents.issue can't build the document ${argument ?? '(none named)'}: its work process issues it.`
            });
        const language = currentContext()?.language ?? 'am';
        const issued = await issueDocument(tx, this.settings, {
            regionId,
            handlingUnitId,
            templateKey: argument,
            data: await applicationCopy(tx, { caseId, caseNumber, config }, language),
            language,
            caseId,
            subject: { table: 'workflow.cases', id: caseId }
        });
        const known = (facts.documents ?? {}) as Record<string, string>;
        return { facts: { documents: { ...known, [argument]: issued.id } } };
    }
}
