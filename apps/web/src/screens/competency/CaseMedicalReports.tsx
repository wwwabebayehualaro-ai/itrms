'use client';

/**
 * A renewal's medical reports on its case page (task 1.6a): each institution's report (facility, day, number, recommendation), and
 * for one that grants with conditions, whether they are on record. The conditions are a health fact (ADR-0064 §4): an officer
 * records them here, never in a form, and the competency lead reads them with a reason (the audited reveal, a recent second
 * factor). What was shown goes when the page is left: it is never cached.
 */
import { useState } from 'react';
import { Eye, NotebookPen } from 'lucide-react';
import { MAX_MEDICAL_INSTITUTIONS, MEDICAL_CONDITIONS_MAX } from '@itrms/competency/contracts';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    StatusBadge,
    Textarea,
    type Tone
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import {
    revealMedicalConditions,
    useMedicalReports,
    useRecordMedicalConditions,
    type MedicalReport
} from '@/lib/competency';
import { formatDay } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';

const TONE: Record<NonNullable<MedicalReport['recommendation']>, Tone> = {
    grant: 'success',
    grant_with_conditions: 'warning',
    refuse: 'danger'
};

function RecordConditions({ caseId, report }: { caseId: string; report: MedicalReport }) {
    const { t } = useText();
    const record = useRecordMedicalConditions(caseId);
    const [open, setOpen] = useState(false);
    const [conditions, setConditions] = useState('');
    return (
        <>
            <Button size="sm" variant="outline" data-action="record-conditions" onClick={() => setOpen(true)}>
                <NotebookPen />
                {t('competency.medical.record')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent data-conditions-dialog>
                    <DialogHeader>
                        <DialogTitle>{t('competency.medical.record')}</DialogTitle>
                        <DialogDescription>{t('competency.medical.recordWhy')}</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`conditions-${report.id}`}>{t('competency.medical.conditions')}</Label>
                        <Textarea
                            id={`conditions-${report.id}`}
                            value={conditions}
                            maxLength={MEDICAL_CONDITIONS_MAX}
                            onChange={(e) => setConditions(e.target.value)}
                        />
                    </div>
                    {record.error && (
                        <p className="text-destructive text-sm" role="alert">
                            {getApiErrorMessage(record.error, t('competency.medical.failed'))}
                        </p>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            {t('competency.health.cancel')}
                        </Button>
                        <Button
                            disabled={conditions.trim().length < 2 || record.isPending}
                            onClick={() =>
                                record.mutate(
                                    { id: report.id, conditions: conditions.trim() },
                                    {
                                        onSuccess: () => {
                                            setConditions('');
                                            setOpen(false);
                                        }
                                    }
                                )
                            }
                        >
                            {t('competency.health.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function RevealConditions({ report, onShown }: { report: MedicalReport; onShown: (value: string) => void }) {
    const { t } = useText();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    const reveal = async () => {
        setBusy(true);
        setError(null);
        try {
            const shown = await revealMedicalConditions(report.id, reason.trim());
            onShown(shown.conditions ?? t('competency.medical.none'));
            setOpen(false);
        } catch (e) {
            setError(e);
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            <Button size="sm" variant="outline" data-action="reveal-conditions" onClick={() => setOpen(true)}>
                <Eye />
                {t('competency.medical.reveal')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent data-reveal-dialog>
                    <DialogHeader>
                        <DialogTitle>{t('competency.medical.reveal')}</DialogTitle>
                        <DialogDescription>{t('competency.health.why')}</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`conditions-reason-${report.id}`}>{t('competency.health.reason')}</Label>
                        <Textarea
                            id={`conditions-reason-${report.id}`}
                            value={reason}
                            maxLength={500}
                            onChange={(e) => setReason(e.target.value)}
                        />
                    </div>
                    {!!error && (
                        <p className="text-destructive text-sm" role="alert">
                            {getApiErrorMessage(error)}
                        </p>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            {t('competency.health.cancel')}
                        </Button>
                        <Button disabled={reason.trim().length < 10 || busy} onClick={() => void reveal()}>
                            {t('competency.health.show')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function ReportRow({ caseId, report, open }: { caseId: string; report: MedicalReport; open: boolean }) {
    const { t, language } = useText();
    const { calendar } = usePreferences();
    const mayRecord = useCan('licence-health:record');
    const mayReveal = useCan('licence-health:reveal');
    const [shown, setShown] = useState<string | null>(null);
    const conditional = report.recommendation === 'grant_with_conditions';
    return (
        <li
            className="flex flex-col gap-1 border-t pt-2 first:border-t-0 first:pt-0"
            data-medical-report={report.sequence}
            data-recommendation={report.recommendation ?? 'none'}
        >
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                    {t('competency.medical.turn', {
                        n: String(report.sequence),
                        max: String(MAX_MEDICAL_INSTITUTIONS)
                    })}
                </span>
                <span>{report.facility}</span>
                <span className="text-muted-foreground">
                    {t('competency.medical.examinedOn')}: {formatDay(report.examinedOn, { language, calendar })}
                </span>
                {report.reportNumber && (
                    <span className="text-muted-foreground">
                        {t('competency.medical.reportNumber')}: {report.reportNumber}
                    </span>
                )}
                {report.recommendation && (
                    <StatusBadge
                        value={report.recommendation}
                        tone={TONE[report.recommendation]}
                        label={t(`competency.medical.recommendation.${report.recommendation}`)}
                    />
                )}
            </div>
            {conditional && (
                <div
                    className="flex flex-wrap items-center gap-2 text-sm"
                    data-conditions={report.conditionsOnRecord ? 'on-record' : 'missing'}
                >
                    {report.conditionsOnRecord ? (
                        <StatusBadge value="on-record" tone="info" label={t('competency.medical.conditionsOnRecord')} />
                    ) : (
                        <span className="text-destructive">{t('competency.medical.conditionsMissing')}</span>
                    )}
                    {shown !== null && (
                        <span className="font-medium" data-revealed>
                            {shown}
                        </span>
                    )}
                    {open && mayRecord && <RecordConditions caseId={caseId} report={report} />}
                    {mayReveal && report.conditionsOnRecord && shown === null && (
                        <RevealConditions report={report} onShown={setShown} />
                    )}
                </div>
            )}
        </li>
    );
}

/**
 * Shown on a case whose workflow has the renewal's medical step: the platform's case page knows no service, so the step's key
 * tells it; a case with no report yet shows nothing.
 */
export function CaseMedicalReports({ caseId, open, enabled }: { caseId: string; open: boolean; enabled: boolean }) {
    const { t } = useText();
    // a recommendation is a health outcome: listed to those who record health facts
    const mayRead = useCan('licence-health:record');
    const reports = useMedicalReports(caseId, enabled && mayRead);
    const items = reports.data?.items ?? [];
    if (!enabled || items.length === 0) return null;
    return (
        <section className="flex flex-col gap-2 rounded-md border p-4" data-case-medical>
            <h2 className="font-medium">{t('competency.medical.title')}</h2>
            <ul className="flex flex-col gap-2">
                {items.map((r) => (
                    <ReportRow key={r.id} caseId={caseId} report={r} open={open} />
                ))}
            </ul>
        </section>
    );
}
