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
import { formVersions, openFieldsFor, RegistryLookups, submissions } from '@itrms/forms/api';

import { ISSUE_DOCUMENT_EFFECT } from '../contracts';
import { addisDay, issueDocument } from './issue';
import { valueOf } from './answers';
import { pick } from './render/format';

/**
 * The case's request as the applicant filed it, in the document's language. Only what anyone may be shown (the forms slice's
 * own rule): never a Sensitive field or one inside a Sensitive container, a removed field, or one a role's rule restricts.
 */
async function applicationCopy(
    tx: Tx,
    run: { caseId: string; caseNumber: number; config: Readonly<Record<string, unknown>> },
    language: string,
    lookups: RegistryLookups
) {
    const [request] = await tx
        .select({ answers: submissions.answers, document: formVersions.document, createdAt: submissions.createdAt })
        .from(submissions)
        .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
        .where(eq(submissions.caseId, run.caseId))
        .orderBy(asc(submissions.createdAt))
        .limit(1);
    if (!request) throw new ConflictError('contract_unmet', { detail: 'The case has no request to copy.' });
    const fields = openFieldsFor(request.document, [], language);
    // the names of the records the lookups picked, from each registry, as the person acting may see them
    const labels = new Map<string, string>();
    const byProvider = new Map<string, string[]>();
    for (const field of fields) {
        const provider = field.type === 'RegistryLookup' ? field.props.provider : undefined;
        const answer = request.answers[field.id];
        const ids = (Array.isArray(answer) ? answer : [answer]).filter((v): v is string => typeof v === 'string');
        if (typeof provider === 'string' && ids.length > 0)
            byProvider.set(provider, [...(byProvider.get(provider) ?? []), ...ids]);
    }
    for (const [key, ids] of byProvider) {
        const provider = lookups.get(key);
        if (!provider) continue;
        for (const item of await provider.resolve(tx, [...new Set(ids)], language)) labels.set(item.id, item.label);
    }
    return {
        caseNumber: run.caseNumber,
        serviceName: pick(run.config.serviceName, language),
        filedOn: addisDay(request.createdAt),
        fields: fields.flatMap((field) =>
            field.id in request.answers
                ? [
                      {
                          label: field.label || field.id,
                          value: valueOf(field, request.answers[field.id], language, labels)
                      }
                  ]
                : []
        )
    };
}

@Injectable()
@Effect(ISSUE_DOCUMENT_EFFECT)
export class IssueDocumentEffect implements WorkflowEffect {
    constructor(
        @Inject(SettingsService) private readonly settings: SettingsService,
        @Inject(RegistryLookups) private readonly lookups: RegistryLookups
    ) {}

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
            data: await applicationCopy(tx, { caseId, caseNumber, config }, language, this.lookups),
            language,
            caseId,
            subject: { table: 'workflow.cases', id: caseId }
        });
        const known = (facts.documents ?? {}) as Record<string, string>;
        return { facts: { documents: { ...known, [argument]: issued.id } } };
    }
}
