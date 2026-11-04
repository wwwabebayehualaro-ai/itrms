/**
 * `documents.issue:<template>` (task 0.23a): named on a workflow's transition, it issues the case's document of that template
 * in the transition's transaction. Run twice (a step taken again), it is the same document. This slice can build the
 * application copy from the case's request; a work process with its own data (a licence, an exam) issues through
 * DocumentsService from its own effect.
 */
import { Inject, Injectable } from '@nestjs/common';
import { asc, and, eq, isNotNull } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';
import { ConflictError } from '@itrms/kernel/errors';
import { SettingsService } from '@itrms/kernel/settings';
import { formVersions, submissions } from '@itrms/forms/api';
import type { I18nText } from '@itrms/schemas';

import { ISSUE_DOCUMENT_EFFECT } from '../contracts';
import { addisDay, issueDocument } from './issue';

const textOf = (label: unknown): I18nText => {
    if (typeof label === 'string') return { am: label, en: label };
    if (label && typeof label === 'object') return label as I18nText;
    return { am: '', en: '' };
};

/** What an answer prints as: an option's label where the field lists options, else its text. */
function valueOf(field: Record<string, unknown>, value: unknown): string {
    if (value === null || value === undefined) return '';
    const props = field.props as { options?: unknown } | undefined;
    const data = field.data as { dataSource?: { staticData?: unknown } } | undefined;
    const options = props?.options ?? data?.dataSource?.staticData;
    const one = (v: unknown): string => {
        if (Array.isArray(options)) {
            const found = (options as { value?: unknown; label?: unknown }[]).find((o) => o.value === v);
            if (found) {
                const label = textOf(found.label);
                return label.am ?? label.en ?? String(v);
            }
        }
        return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
    };
    return Array.isArray(value) ? value.map(one).filter(Boolean).join(', ') : one(value);
}

/** The case's request as the applicant filed it: its plain answers, never a sensitive field. */
async function applicationCopy(tx: Tx, caseId: string, caseNumber: number, config: Readonly<Record<string, unknown>>) {
    const [request] = await tx
        .select({ answers: submissions.answers, document: formVersions.document, createdAt: submissions.createdAt })
        .from(submissions)
        .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
        .where(and(eq(submissions.caseId, caseId), isNotNull(submissions.caseId)))
        .orderBy(asc(submissions.createdAt))
        .limit(1);
    if (!request) throw new ConflictError('contract_unmet', { detail: 'The case has no request to copy.' });
    const { fields = [] } = request.document as { fields?: Record<string, unknown>[] };
    return {
        caseNumber,
        serviceName: textOf(config.serviceName),
        filedOn: addisDay(request.createdAt),
        fields: fields.flatMap((field) => {
            const id = typeof field.id === 'string' ? field.id : '';
            if (!id || !(id in request.answers) || field.classification === 'sensitive') return [];
            return [{ label: textOf(field.label), value: valueOf(field, request.answers[id]) }];
        })
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
        const issued = await issueDocument(tx, this.settings, {
            regionId,
            handlingUnitId,
            templateKey: argument,
            data: await applicationCopy(tx, caseId, caseNumber, config),
            language: currentContext()?.language ?? 'am',
            caseId,
            subject: { table: 'workflow.cases', id: caseId }
        });
        const known = (facts.documents ?? {}) as Record<string, string>;
        return { facts: { documents: { ...known, [argument]: issued.id } } };
    }
}
