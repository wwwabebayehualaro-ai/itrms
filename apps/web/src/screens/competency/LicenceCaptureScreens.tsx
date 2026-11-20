'use client';

/**
 * The back-capture of paper driver licences (MIG-02, ADR-0054, task 1.6b): the platform's own requests list narrowed to MIG-02, and
 * the printed numbers flagged to the bureau. A clerk captures the paper licence's facts and its scan; a second person checks them
 * against the paper, and only then does the licence join the register with its printed number and card serial. The case page is the
 * platform's.
 */
import Link from 'next/link';
import {
    Button,
    EmptyState,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useLicenceNumberFlags } from '@/lib/competency';
import { formatMoment } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { Requests } from '@/screens/workflow/Requests';

function NumberFlags() {
    const { t, text, language } = useText();
    const { calendar } = usePreferences();
    const flags = useLicenceNumberFlags(useCan('licence:read'));
    const items = flags.data?.items ?? [];
    return (
        <section className="flex flex-col gap-2" data-licence-number-flags>
            <h2 className="font-medium">{t('competency.licenceCaptures.flags')}</h2>
            <p className="text-muted-foreground text-sm">{t('competency.licenceCaptures.flagsIntro')}</p>
            {items.length === 0 ? (
                <EmptyState title={t('competency.licenceCaptures.noFlags')} />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('competency.licenceCaptures.number')}</TableHead>
                            <TableHead>{t('competency.licenceCaptures.reasonLabel')}</TableHead>
                            <TableHead>{t('competency.licenceCaptures.note')}</TableHead>
                            <TableHead>{t('competency.licenceCaptures.paperReference')}</TableHead>
                            <TableHead>{t('competency.licenceCaptures.office')}</TableHead>
                            <TableHead>{t('competency.licenceCaptures.flaggedAt')}</TableHead>
                            <TableHead>{t('competency.licenceCaptures.case')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((f) => (
                            <TableRow key={f.id} data-flag={f.number} data-reason={f.reason}>
                                <TableCell className="font-medium">{f.number}</TableCell>
                                <TableCell>
                                    <StatusBadge
                                        value={f.reason}
                                        tone="warning"
                                        label={t(`competency.licenceCaptures.reason.${f.reason}`)}
                                    />
                                </TableCell>
                                <TableCell className="max-w-xs whitespace-pre-wrap" data-flag-note>
                                    {f.note ?? '—'}
                                </TableCell>
                                <TableCell>{f.paperReference}</TableCell>
                                <TableCell>{text(f.handlingUnit.name)}</TableCell>
                                <TableCell>{formatMoment(f.flaggedAt, { language, calendar })}</TableCell>
                                <TableCell>
                                    <Link className="underline" href={`/cases/${f.caseId}`}>
                                        {f.caseNumber ?? t('competency.licenceCaptures.case')}
                                    </Link>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </section>
    );
}

export function LicenceCaptures() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    return (
        <div className="flex flex-col gap-8">
            <Requests
                fixed={{ service: 'MIG-02' }}
                title={t('competency.licenceCaptures.title')}
                intro={t('competency.licenceCaptures.intro')}
                toolbar={
                    mayFile ? (
                        <div data-licence-captures>
                            <Button asChild>
                                <Link href="/competency/licence-captures/new">
                                    {t('competency.licenceCaptures.fileNew')}
                                </Link>
                            </Button>
                        </div>
                    ) : undefined
                }
            />
            <NumberFlags />
        </div>
    );
}
