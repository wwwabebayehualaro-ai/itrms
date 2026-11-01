'use client';

/** Asks for a receipt's reversal (task 0.22b): a reason of 10 to 500 characters; another person decides. */
import { useState } from 'react';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    Textarea,
    useNotify
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useRequestReversal } from '@/lib/fees';
import { useText } from '@/lib/preferences';

export function ReversalDialog({
    receiptId,
    receiptNumber,
    onClose
}: {
    receiptId: string;
    receiptNumber: string;
    onClose: () => void;
}) {
    const { t } = useText();
    const notify = useNotify();
    const request = useRequestReversal(receiptId);
    const [reason, setReason] = useState('');
    const trimmed = reason.trim();
    const valid = trimmed.length >= 10 && trimmed.length <= 500;
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-reversal-dialog={receiptId}>
                <DialogHeader>
                    <DialogTitle>{t('fees.reversal.requestTitle', { number: receiptNumber })}</DialogTitle>
                    <DialogDescription>{t('fees.reversal.requestIntro')}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reversal-reason">{t('fees.reversal.reason')}</Label>
                    <Textarea
                        id="reversal-reason"
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">{t('fees.reversal.reasonHint')}</p>
                </div>
                {request.error && (
                    <p className="text-destructive text-sm" role="alert">
                        {getApiErrorMessage(request.error)}
                    </p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('fees.reversal.cancel')}
                    </Button>
                    <Button
                        disabled={!valid || request.isPending}
                        onClick={() =>
                            request.mutate(
                                { reason: trimmed },
                                {
                                    onSuccess: () => {
                                        notify.success(t('fees.reversal.requested'));
                                        onClose();
                                    }
                                }
                            )
                        }
                    >
                        {t('fees.reversal.request')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
