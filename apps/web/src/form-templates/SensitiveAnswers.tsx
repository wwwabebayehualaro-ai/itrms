'use client';

/**
 * A record's Sensitive answers (task 0.20d, SEC-PD-2): left out of the record, the lists and the exports, and named
 * here; someone who may reveal personal data shows them with a reason, recorded in the audit log with who and when.
 * What was shown goes when the record is left (it is never cached).
 */
import { useState } from 'react';
import { Eye, ShieldAlert } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    DescriptionList,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    Textarea
} from '@itrms/ui';

import client from '@/lib/api/client';
import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { useText } from '@/lib/preferences';

export function SensitiveAnswers({
    submissionId,
    masked,
    labelOf
}: {
    submissionId: string;
    masked: readonly string[];
    labelOf: (key: string) => string;
}) {
    const { t } = useText();
    const mayReveal = useCan('pii:reveal');
    const [asking, setAsking] = useState(false);
    const [reason, setReason] = useState('');
    const [shown, setShown] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    if (masked.length === 0) return null;

    const reveal = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await client.post<{ answers: Record<string, unknown> }>(
                `v1/submissions/${submissionId}/reveal`,
                { reason: reason.trim() }
            );
            setShown(res.data.answers);
            setAsking(false);
        } catch (e) {
            setError(e);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Alert data-sensitive-answers>
            <ShieldAlert />
            <AlertTitle>{t('forms.sensitive.title')}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
                <span>{t('forms.sensitive.hidden', { fields: masked.map(labelOf).join(', ') })}</span>
                {shown ? (
                    <DescriptionList
                        data-revealed
                        items={Object.entries(shown).map(([key, value]) => ({
                            term: labelOf(key),
                            value: typeof value === 'string' ? value : JSON.stringify(value)
                        }))}
                    />
                ) : (
                    mayReveal && (
                        <Button size="sm" variant="outline" className="w-fit" onClick={() => setAsking(true)}>
                            <Eye />
                            {t('forms.sensitive.reveal')}
                        </Button>
                    )
                )}
            </AlertDescription>
            <Dialog open={asking} onOpenChange={setAsking}>
                <DialogContent data-reveal-dialog>
                    <DialogHeader>
                        <DialogTitle>{t('forms.sensitive.reveal')}</DialogTitle>
                        <DialogDescription>{t('forms.sensitive.why')}</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reveal-reason">{t('forms.sensitive.reason')}</Label>
                        <Textarea
                            id="reveal-reason"
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
                        <Button variant="outline" onClick={() => setAsking(false)}>
                            {t('forms.sensitive.cancel')}
                        </Button>
                        <Button disabled={reason.trim().length < 5 || busy} onClick={() => void reveal()}>
                            {t('forms.sensitive.show')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Alert>
    );
}
