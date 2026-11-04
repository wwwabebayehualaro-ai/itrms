'use client';

/**
 * Money paid elsewhere on a payment order's page (task 0.22c): the counter enters the receipt or reference of an order a
 * revenue office or a bank collects, and everyone with the right sees its references and how they stand. Who may verify
 * also revokes a verified one here, with a reason.
 */
import { useState } from 'react';
import { z } from 'zod';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    EthiopianDatePicker,
    Field,
    FieldLabel,
    Label,
    MoneyInput,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Textarea,
    useNotify,
    useZodForm,
    ZodForm,
    type Tone
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import {
    useEnterExternalRef,
    useExternalIssuers,
    useRevokeExternalRef,
    type ExternalRefOut,
    type PaymentOrderOut
} from '@/lib/fees';
import { formatDay, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { ErrorsOf, todayInAddis } from './form-bits';

export const REF_TONE: Record<ExternalRefOut['state'], Tone> = {
    pending_verification: 'progress',
    verified: 'success',
    rejected: 'danger',
    revoked: 'danger',
    withdrawn: 'muted'
};

/** Enters a reference: the whole total, as the receipt says. */
export function ExternalRefForm({ order }: { order: PaymentOrderOut }) {
    const { t, text, language } = useText();
    const notify = useNotify();
    const enter = useEnterExternalRef(order.id);
    const issuers = useExternalIssuers();

    const schema = z.object({
        issuer: z.string().min(1, t('fees.external.invalid.issuer')),
        reference: z
            .string()
            .trim()
            .min(1, t('fees.external.invalid.reference'))
            .max(40, t('fees.external.invalid.reference')),
        amountSantim: z.string().regex(/^[1-9]\d{0,17}$/, t('fees.external.invalid.amount')),
        paidOn: z.string().min(1, t('fees.external.invalid.paidOn')),
        receivedFrom: z
            .string()
            .trim()
            .min(2, t('fees.external.invalid.receivedFrom'))
            .max(200, t('fees.external.invalid.receivedFrom'))
    });
    const form = useZodForm({
        schema,
        defaultValues: { issuer: '', reference: '', amountSantim: '', paidOn: '', receivedFrom: '' },
        onSubmit: async (v) => {
            await enter.mutateAsync(v);
            notify.success(t('fees.external.form.saved'));
        }
    });

    return (
        <section className="flex flex-col gap-3 rounded-md border p-4" data-external-form>
            <h2 className="font-medium">{t('fees.external.form.title')}</h2>
            <p className="text-muted-foreground text-sm">
                {t('fees.external.form.intro', {
                    total: formatMoney(order.totalSantim, language),
                    place: t('fees.external.form.place')
                })}
            </p>
            <ZodForm form={form}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <form.AppField name="issuer">
                        {(f) => (
                            <f.SelectField
                                label={t('fees.external.form.issuer')}
                                placeholder={t('fees.external.form.issuerPlaceholder')}
                                options={(issuers.data?.items ?? []).map((i) => ({
                                    value: i.code,
                                    label: text(i.name)
                                }))}
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="reference">
                        {(f) => (
                            <f.TextField label={t('fees.external.form.reference')} maxLength={40} autoComplete="off" />
                        )}
                    </form.AppField>
                    <form.AppField name="amountSantim">
                        {(field) => (
                            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                                <FieldLabel htmlFor="external-amount">{t('fees.external.form.amount')}</FieldLabel>
                                <MoneyInput
                                    id="external-amount"
                                    unit={t('common.money.unit')}
                                    refusedMessage={t('common.money.refused')}
                                    value={field.state.value === '' ? null : BigInt(field.state.value)}
                                    onValueChange={(santim) =>
                                        field.handleChange(santim === null ? '' : santim.toString())
                                    }
                                    onBlur={field.handleBlur}
                                />
                                <ErrorsOf errors={field.state.meta.errors} touched={field.state.meta.isTouched} />
                            </Field>
                        )}
                    </form.AppField>
                    <form.AppField name="paidOn">
                        {(field) => (
                            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                                <FieldLabel htmlFor="external-paid-on">{t('fees.external.form.paidOn')}</FieldLabel>
                                <EthiopianDatePicker
                                    id="external-paid-on"
                                    value={field.state.value || null}
                                    onChange={(v) => field.handleChange(v ?? '')}
                                    onOpenChange={(open) => !open && field.handleBlur()}
                                    language={language === 'en' ? 'en' : 'am'}
                                    max={todayInAddis()}
                                    labels={{
                                        placeholder: t('fees.payment.pickDate'),
                                        previousMonth: t('fees.payment.previousMonth'),
                                        nextMonth: t('fees.payment.nextMonth'),
                                        clear: t('fees.payment.clear'),
                                        month: t('fees.payment.month'),
                                        year: t('fees.payment.year')
                                    }}
                                />
                                <ErrorsOf errors={field.state.meta.errors} touched={field.state.meta.isTouched} />
                            </Field>
                        )}
                    </form.AppField>
                </div>
                <form.AppField name="receivedFrom">
                    {(f) => (
                        <f.TextField label={t('fees.external.form.receivedFrom')} maxLength={200} autoComplete="off" />
                    )}
                </form.AppField>
                <div className="flex justify-end">
                    <form.AppForm>
                        <form.SubmitButton data-action="enter-reference">
                            {t('fees.external.form.submit')}
                        </form.SubmitButton>
                    </form.AppForm>
                </div>
            </ZodForm>
        </section>
    );
}

/** The order's references, newest first. */
export function ExternalRefList({ order }: { order: PaymentOrderOut }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const mayRevoke = useCan('external-payment:verify');
    const issuers = useExternalIssuers();
    const [revoking, setRevoking] = useState<ExternalRefOut | null>(null);
    if (order.externalRefs.length === 0) return null;
    const nameOf = (code: string) => {
        const issuer = issuers.data?.items.find((i) => i.code === code);
        return issuer ? text(issuer.name) : code;
    };
    return (
        <section className="flex flex-col gap-3">
            <h2 className="font-medium">{t('fees.external.caption')}</h2>
            <Table data-external-refs>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('fees.external.col.issuer')}</TableHead>
                        <TableHead>{t('fees.external.col.reference')}</TableHead>
                        <TableHead>{t('fees.external.col.paidOn')}</TableHead>
                        <TableHead className="text-right">{t('fees.external.col.amount')}</TableHead>
                        <TableHead>{t('fees.external.col.state')}</TableHead>
                        <TableHead className="text-right">{t('fees.external.col.actions')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {order.externalRefs.map((r) => (
                        <TableRow key={r.id} data-external-ref={r.id} data-state={r.state}>
                            <TableCell>{nameOf(r.issuer)}</TableCell>
                            <TableCell>{r.reference}</TableCell>
                            <TableCell>{formatDay(r.paidOn, { language, calendar })}</TableCell>
                            <TableCell className="text-right tabular-nums">
                                {formatMoney(r.amountSantim, language)}
                            </TableCell>
                            <TableCell>
                                <div className="flex flex-col gap-1">
                                    <StatusBadge
                                        value={r.state}
                                        tone={REF_TONE[r.state]}
                                        label={t(`fees.external.state.${r.state}`)}
                                    />
                                    {r.verifiedVia && (
                                        <span className="text-muted-foreground text-xs">
                                            {t(`fees.external.via.${r.verifiedVia}`)}
                                        </span>
                                    )}
                                    {(r.note ?? r.revokeReason) && (
                                        <span className="text-muted-foreground text-xs whitespace-pre-wrap">
                                            {r.revokeReason ?? r.note}
                                        </span>
                                    )}
                                </div>
                            </TableCell>
                            <TableCell className="text-right">
                                {mayRevoke && r.state === 'verified' && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        data-action="revoke-reference"
                                        onClick={() => setRevoking(r)}
                                    >
                                        {t('fees.external.revoke')}
                                    </Button>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {revoking && <RevokeDialog reference={revoking} onClose={() => setRevoking(null)} />}
        </section>
    );
}

function RevokeDialog({ reference, onClose }: { reference: ExternalRefOut; onClose: () => void }) {
    const { t } = useText();
    const notify = useNotify();
    const revoke = useRevokeExternalRef();
    const [reason, setReason] = useState('');
    const usable = reason.trim().length >= 10;
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-revoke-dialog>
                <DialogHeader>
                    <DialogTitle>{t('fees.external.revocation.title', { reference: reference.reference })}</DialogTitle>
                    <DialogDescription>{t('fees.external.revocation.intro')}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="revoke-reason">{t('fees.external.revocation.reason')}</Label>
                    <Textarea
                        id="revoke-reason"
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">{t('fees.external.revocation.reasonHint')}</p>
                </div>
                {revoke.error && (
                    <p className="text-destructive text-sm" role="alert">
                        {getApiErrorMessage(revoke.error)}
                    </p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('fees.reversal.cancel')}
                    </Button>
                    <Button
                        disabled={!usable || revoke.isPending}
                        onClick={() =>
                            revoke.mutate(
                                { id: reference.id, reason: reason.trim() },
                                {
                                    onSuccess: () => {
                                        notify.success(t('fees.external.revocation.saved'));
                                        onClose();
                                    }
                                }
                            )
                        }
                    >
                        {t('fees.external.revoke')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
