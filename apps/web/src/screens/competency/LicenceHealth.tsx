'use client';

/**
 * A licence's blood group in the register (task 1.6, ADR-0052): the row says only whether one is on record. An officer or the
 * lead records it while the region collects it; the lead reads it in clear with a reason (the audited reveal, a recent second
 * factor). What was shown goes when the row is left: it is never cached.
 */
import { useState } from 'react';
import { Droplet, Eye } from 'lucide-react';
import { BLOOD_GROUPS } from '@itrms/competency/contracts';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    StatusBadge,
    Textarea
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { revealBloodGroup, useRecordBloodGroup, type BloodGroup, type Licence } from '@/lib/competency';
import { useText } from '@/lib/preferences';

function RecordBloodGroup({ licence }: { licence: Licence }) {
    const { t } = useText();
    const record = useRecordBloodGroup();
    const [open, setOpen] = useState(false);
    const [group, setGroup] = useState<BloodGroup | undefined>();
    return (
        <>
            <Button size="sm" variant="outline" data-action="record-blood-group" onClick={() => setOpen(true)}>
                <Droplet />
                {t('competency.health.record')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent data-blood-group-dialog>
                    <DialogHeader>
                        <DialogTitle>{t('competency.health.record')}</DialogTitle>
                        <DialogDescription>{t('competency.health.recordWhy')}</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`blood-group-${licence.id}`}>{t('competency.health.bloodGroup')}</Label>
                        <Select value={group ?? ''} onValueChange={(v) => setGroup(v as BloodGroup)}>
                            <SelectTrigger id={`blood-group-${licence.id}`} className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {BLOOD_GROUPS.map((g) => (
                                    <SelectItem key={g} value={g}>
                                        {g}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {record.error && (
                        <p className="text-destructive text-sm" role="alert">
                            {getApiErrorMessage(record.error, t('competency.health.failed'))}
                        </p>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            {t('competency.health.cancel')}
                        </Button>
                        <Button
                            disabled={!group || record.isPending}
                            onClick={() =>
                                group &&
                                record.mutate(
                                    { id: licence.id, bloodGroup: group },
                                    { onSuccess: () => setOpen(false) }
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

function RevealBloodGroup({ licence, onShown }: { licence: Licence; onShown: (value: string) => void }) {
    const { t } = useText();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    const reveal = async () => {
        setBusy(true);
        setError(null);
        try {
            const shown = await revealBloodGroup(licence.id, reason.trim());
            onShown(shown.bloodGroup ?? t('competency.health.none'));
            setOpen(false);
        } catch (e) {
            setError(e);
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            <Button size="sm" variant="outline" data-action="reveal-blood-group" onClick={() => setOpen(true)}>
                <Eye />
                {t('competency.health.reveal')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent data-reveal-dialog>
                    <DialogHeader>
                        <DialogTitle>{t('competency.health.reveal')}</DialogTitle>
                        <DialogDescription>{t('competency.health.why')}</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`reveal-reason-${licence.id}`}>{t('competency.health.reason')}</Label>
                        <Textarea
                            id={`reveal-reason-${licence.id}`}
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

/** The row's blood group cell: on record or not, and the actions the person may take. */
export function LicenceHealthCell({ licence }: { licence: Licence }) {
    const { t } = useText();
    const mayRecord = useCan('licence-health:record');
    const mayReveal = useCan('licence-health:reveal');
    const [shown, setShown] = useState<string | null>(null);
    const usable = licence.status !== 'voided';
    return (
        <div
            className="flex flex-wrap items-center gap-1"
            data-blood-group={licence.bloodGroupOnRecord ? 'on-record' : 'none'}
        >
            {licence.bloodGroupOnRecord ? (
                <StatusBadge value="on-record" tone="info" label={t('competency.licence.bloodGroupOnRecord')} />
            ) : (
                <span className="text-muted-foreground text-sm">{t('competency.licence.noBloodGroup')}</span>
            )}
            {shown !== null && (
                <span className="font-medium" data-revealed>
                    {shown}
                </span>
            )}
            {usable && mayRecord && licence.bloodGroupCollected && <RecordBloodGroup licence={licence} />}
            {usable && mayReveal && licence.bloodGroupOnRecord && shown === null && (
                <RevealBloodGroup licence={licence} onShown={setShown} />
            )}
        </div>
    );
}
