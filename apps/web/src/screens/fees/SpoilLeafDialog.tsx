'use client';

/** Spoils a leaf of the office's receipt pad (task 1.12e): the leaf as printed and a reason of 10 to 500 characters. */
import { useState } from 'react';
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
    Textarea,
    useNotify
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useSpoilReceiptLeaf } from '@/lib/fees';
import { useText } from '@/lib/preferences';

export function SpoilLeafDialog({ onClose }: { onClose: () => void }) {
    const { t } = useText();
    const notify = useNotify();
    const spoil = useSpoilReceiptLeaf();
    const [key, setKey] = useState('');
    const [reason, setReason] = useState('');
    const reasonText = reason.trim();
    const valid = key.trim().length >= 2 && reasonText.length >= 10 && reasonText.length <= 500;
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-spoil-leaf-dialog>
                <DialogHeader>
                    <DialogTitle>{t('fees.leaf.spoilTitle')}</DialogTitle>
                    <DialogDescription>{t('fees.leaf.spoilIntro')}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="spoil-leaf-key">{t('fees.leaf.key')}</Label>
                    <Input id="spoil-leaf-key" value={key} maxLength={20} onChange={(e) => setKey(e.target.value)} />
                    <p className="text-muted-foreground text-xs">{t('fees.leaf.keyHint')}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="spoil-leaf-reason">{t('fees.leaf.reason')}</Label>
                    <Textarea
                        id="spoil-leaf-reason"
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">{t('fees.leaf.reasonHint')}</p>
                </div>
                {spoil.error && (
                    <p className="text-destructive text-sm" role="alert">
                        {getApiErrorMessage(spoil.error)}
                    </p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('fees.leaf.cancel')}
                    </Button>
                    <Button
                        disabled={!valid || spoil.isPending}
                        data-action="spoil-leaf"
                        onClick={() =>
                            spoil.mutate(
                                { key: key.trim(), reason: reasonText },
                                {
                                    onSuccess: () => {
                                        notify.success(t('fees.leaf.done'));
                                        onClose();
                                    }
                                }
                            )
                        }
                    >
                        {t('fees.leaf.spoil')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
