'use client';

/**
 * The card handed over at the desk (task 1.6d, ADR-0064 §7): the serial printed on it, who took it and the ID they showed. It closes
 * the licence's temporary driving permit, whose QR then reports revoked. The ID number goes to the server and is kept encrypted;
 * nothing of it stays on this screen once the dialog closes.
 */
import { useState } from 'react';
import { IdCard } from 'lucide-react';
import { HANDOVER_RECIPIENTS, RECIPIENT_ID_KINDS, RECIPIENT_ID_MAX } from '@itrms/competency/contracts';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { useHandOverCard, type Licence } from '@/lib/competency';
import { useText } from '@/lib/preferences';

type Recipient = (typeof HANDOVER_RECIPIENTS)[number];
type IdKind = (typeof RECIPIENT_ID_KINDS)[number];

function HandOverDialog({ licence, onClose }: { licence: Licence; onClose: () => void }) {
    const { t } = useText();
    const handOver = useHandOverCard();
    const [serial, setSerial] = useState('');
    const [recipient, setRecipient] = useState<Recipient>('holder');
    const [representative, setRepresentative] = useState('');
    const [idKind, setIdKind] = useState<IdKind>('fayda');
    const [idNumber, setIdNumber] = useState('');
    const ready =
        serial.trim() !== '' && idNumber.trim() !== '' && (recipient === 'holder' || representative.trim().length >= 2);
    const field = (id: string) => `handover-${id}-${licence.id}`;
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-card-handover-dialog>
                <DialogHeader>
                    <DialogTitle>{t('competency.handover.title')}</DialogTitle>
                    <DialogDescription>{t('competency.handover.why')}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={field('serial')}>{t('competency.handover.cardSerial')}</Label>
                        <Input
                            id={field('serial')}
                            value={serial}
                            maxLength={20}
                            onChange={(e) => setSerial(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={field('recipient')}>{t('competency.handover.recipient')}</Label>
                        <Select value={recipient} onValueChange={(v) => setRecipient(v as Recipient)}>
                            <SelectTrigger id={field('recipient')} className="w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {HANDOVER_RECIPIENTS.map((r) => (
                                    <SelectItem key={r} value={r}>
                                        {t(`competency.handover.recipients.${r}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {recipient === 'representative' && (
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor={field('representative')}>
                                {t('competency.handover.representativeName')}
                            </Label>
                            <Input
                                id={field('representative')}
                                value={representative}
                                maxLength={120}
                                onChange={(e) => setRepresentative(e.target.value)}
                            />
                        </div>
                    )}
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={field('id-kind')}>{t('competency.handover.idKind')}</Label>
                        <Select value={idKind} onValueChange={(v) => setIdKind(v as IdKind)}>
                            <SelectTrigger id={field('id-kind')} className="w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {RECIPIENT_ID_KINDS.map((k) => (
                                    <SelectItem key={k} value={k}>
                                        {t(`competency.handover.idKinds.${k}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={field('id-number')}>{t('competency.handover.idNumber')}</Label>
                        <Input
                            id={field('id-number')}
                            value={idNumber}
                            maxLength={RECIPIENT_ID_MAX}
                            autoComplete="off"
                            onChange={(e) => setIdNumber(e.target.value)}
                        />
                    </div>
                </div>
                {handOver.error && (
                    <p className="text-destructive text-sm" role="alert">
                        {getApiErrorMessage(handOver.error, t('competency.handover.failed'))}
                    </p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('competency.health.cancel')}
                    </Button>
                    <Button
                        disabled={!ready || handOver.isPending}
                        onClick={() =>
                            handOver.mutate(
                                {
                                    id: licence.id,
                                    version: licence.version,
                                    handover: {
                                        cardSerial: serial.trim(),
                                        recipient,
                                        ...(recipient === 'representative'
                                            ? { representativeName: representative.trim() }
                                            : {}),
                                        idKind,
                                        idNumber: idNumber.trim()
                                    }
                                },
                                { onSuccess: onClose }
                            )
                        }
                    >
                        {t('competency.handover.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** The row's card: handed over, or the action to hand over a printed one. */
export function LicenceCardCell({ licence }: { licence: Licence }) {
    const { t } = useText();
    const mayHandOver = useCan('licence:hand-over');
    const [open, setOpen] = useState(false);
    if (licence.cardHandedOver)
        return (
            <span className="text-muted-foreground text-sm" data-card-handed-over>
                {t('competency.handover.done')}
            </span>
        );
    const ready = licence.status === 'active' && !licence.restricted && licence.cardSerial !== null;
    if (!ready || !mayHandOver) return null;
    return (
        <>
            <Button size="sm" variant="outline" data-action="hand-over-card" onClick={() => setOpen(true)}>
                <IdCard />
                {t('competency.handover.title')}
            </Button>
            {open && <HandOverDialog licence={licence} onClose={() => setOpen(false)} />}
        </>
    );
}
