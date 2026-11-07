'use client';

/**
 * A case's audit trail (task 0.25e, demo-plan.md §3 step 12): who did what to the case and when, from the audit log, for those who
 * may read it. Only the names of the fields a change touched are shown, never their values.
 */
import { ShieldCheck } from 'lucide-react';
import { InlineStatus } from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { formatMoment } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { useCaseAudit, type CaseAuditEntry } from '@/lib/workflow';

/** The tables of a case's life, by name; another shows as it is called in the database. */
const TABLES = [
    'workflow.cases',
    'workflow.case_tasks',
    'workflow.case_events',
    'forms.submissions',
    'fees.case_fees',
    'fees.payment_orders',
    'fees.payments',
    'fees.receipts',
    'fees.external_payment_refs',
    'documents.issued_documents',
    'competency.driver_licences',
    'competency.exam_results',
    'competency.medical_certificates'
];

export function CaseAuditTrail({ caseId }: { caseId: string }) {
    const { t, language } = useText();
    const { calendar } = usePreferences();
    const audit = useCaseAudit(caseId);
    const what = (e: CaseAuditEntry) =>
        e.action === 'event'
            ? t('workflow.audit.event', { event: e.event ?? '' })
            : t(`workflow.audit.action.${e.action}`, {
                  table:
                      e.table && TABLES.includes(e.table)
                          ? t(`workflow.audit.table.${e.table.replace('.', '_')}`)
                          : (e.table ?? '')
              });
    if (audit.isPending) return <InlineStatus loading />;
    if (audit.error) return <p className="text-destructive text-sm">{getApiErrorMessage(audit.error)}</p>;
    if (audit.data.items.length === 0)
        return <p className="text-sm text-muted-foreground">{t('workflow.audit.empty')}</p>;
    return (
        <div className="flex flex-col gap-2" data-audit>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="size-4" aria-hidden />
                {t('workflow.audit.intro')}
            </p>
            <ol className="flex flex-col gap-1">
                {audit.data.items.map((e, i) => (
                    <li
                        key={`${e.at}-${i}`}
                        className="grid gap-1 rounded-md border p-2 text-sm sm:grid-cols-[12rem_1fr]"
                        data-audit-row={e.action}
                        data-table={e.table ?? undefined}
                    >
                        <time dateTime={e.at} className="text-muted-foreground tabular-nums">
                            {formatMoment(e.at, { language, calendar })}
                        </time>
                        <div className="flex flex-col">
                            <span>
                                <span className="font-medium" data-actor>
                                    {e.actor?.name || t('workflow.audit.system')}
                                </span>
                                {': '}
                                {what(e)}
                            </span>
                            {e.fields.length > 0 && (
                                <span className="text-xs text-muted-foreground" data-fields>
                                    {t('workflow.audit.fields', { fields: e.fields.join(', ') })}
                                </span>
                            )}
                        </div>
                    </li>
                ))}
            </ol>
        </div>
    );
}
