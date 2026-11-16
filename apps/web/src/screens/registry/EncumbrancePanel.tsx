'use client';

/**
 * The encumbrances of a vehicle and of an office (task 1.4a): the table of holds with what each office may do to them (the
 * recording office requests a release on the holder's letter; another person of that office, or of one above it, confirms or
 * refuses), and the dialog that records a new one. The server decides who may; the buttons only follow the same rules.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ENCUMBRANCE_KINDS, encumbranceRecordSchema, releaseRequestSchema } from '@itrms/vehicles/contracts';
import {
    Alert,
    AlertDescription,
    Button,
    Combobox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    EmptyState,
    EthiopianDatePicker,
    Label,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useNotify,
    useZodForm,
    ZodForm
} from '@itrms/ui';
import { z } from 'zod';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import {
    useConfirmRelease,
    useRecordEncumbrance,
    useRefuseRelease,
    useRequestRelease,
    type Encumbrance
} from '@/lib/encumbrances';
import { formatDay } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { useOrganisations } from '@/lib/registry';

const TONE = { open: 'danger', release_pending: 'warning', released: 'muted' } as const;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

/** Birr as typed ("1250.50") to santim as text ("125050"), by the digits: money is never a float. null when it is not an amount. */
export function birrToSantim(typed: string): string | null {
    const match = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(typed.trim());
    if (!match) return null;
    const santim = `${match[1] ?? '0'}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
    return santim === '0' ? null : santim;
}

function DateField({
    id,
    label,
    value,
    onChange
}: {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
}) {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={id}>{label}</Label>
            <EthiopianDatePicker
                id={id}
                value={value || null}
                onChange={(v) => onChange(v ?? '')}
                language={language === 'en' ? 'en' : 'am'}
                max={today()}
                labels={{
                    placeholder: t('vehicles.encumbrance.pickDate'),
                    previousMonth: t('vehicles.encumbrance.previousMonth'),
                    nextMonth: t('vehicles.encumbrance.nextMonth'),
                    clear: t('vehicles.encumbrance.clear'),
                    month: t('vehicles.encumbrance.month'),
                    year: t('vehicles.encumbrance.year')
                }}
            />
            {calendar === 'gregorian' && value && <span className="text-muted-foreground text-xs">{value}</span>}
        </div>
    );
}

/** The holds of a vehicle or of an office, pending releases first; `vehicleLink` adds the vehicle's column (the office's list). */
export function EncumbranceTable({
    items,
    vehicleLink = false
}: {
    items: readonly Encumbrance[];
    vehicleLink?: boolean;
}) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const workspace = useAuthStore((s) => s.workspace);
    const [action, setAction] = useState<{ what: 'request' | 'confirm' | 'refuse'; row: Encumbrance }>();
    const mayRelease = workspace?.permissions.includes('encumbrance:release') ?? false;
    const day = (value: string | null) => formatDay(value, { language, calendar });
    const rank = { release_pending: 0, open: 1, released: 2 } as const;
    const rows = [...items].sort((a, b) => rank[a.status] - rank[b.status]);
    if (rows.length === 0) return <EmptyState title={t('vehicles.encumbrance.none')} />;
    return (
        <>
            <Table data-encumbrances>
                <TableHeader>
                    <TableRow>
                        {vehicleLink && <TableHead>{t('vehicles.encumbrance.vehicle')}</TableHead>}
                        <TableHead>{t('vehicles.encumbrance.kindLabel')}</TableHead>
                        <TableHead>{t('vehicles.encumbrance.holder')}</TableHead>
                        <TableHead>{t('vehicles.encumbrance.letterReference')}</TableHead>
                        <TableHead>{t('vehicles.encumbrance.recordedBy')}</TableHead>
                        <TableHead>{t('vehicles.field.status')}</TableHead>
                        <TableHead />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((e) => {
                        const own = e.recordedUnit.id === workspace?.activeUnit.id;
                        const second = e.releaseRequestedBy?.id !== workspace?.user.id;
                        return (
                            <TableRow key={e.id} data-encumbrance={e.id} data-status={e.status}>
                                {vehicleLink && (
                                    <TableCell>
                                        <Link href={`/registry/vehicles/${e.vehicleId}`} className="hover:underline">
                                            {t('vehicles.encumbrance.vehicle')}
                                        </Link>
                                    </TableCell>
                                )}
                                <TableCell className="font-medium">
                                    {t(`vehicles.encumbrance.kind.${e.kind}`)}
                                </TableCell>
                                <TableCell>{text({ am: '', en: '', ...e.holder.name })}</TableCell>
                                <TableCell>
                                    {e.letterReference}
                                    <span className="text-muted-foreground ms-2 text-xs">{day(e.letterDate)}</span>
                                </TableCell>
                                <TableCell>{text({ am: '', en: '', ...e.recordedUnit.name })}</TableCell>
                                <TableCell>
                                    <StatusBadge
                                        value={e.status}
                                        tone={TONE[e.status]}
                                        label={t(`vehicles.encumbrance.status.${e.status}`)}
                                    />
                                    {e.status === 'release_pending' && e.releaseRequestedBy && (
                                        <div className="text-muted-foreground text-xs">
                                            {t('vehicles.encumbrance.requestedBy', { name: e.releaseRequestedBy.name })}
                                        </div>
                                    )}
                                    {e.status === 'open' && e.releaseRefusalReason && (
                                        <div className="text-muted-foreground text-xs">
                                            {t('vehicles.encumbrance.refusedWith', { reason: e.releaseRefusalReason })}
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell className="text-end">
                                    {mayRelease && e.status === 'open' && own && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            data-request-release={e.id}
                                            onClick={() => setAction({ what: 'request', row: e })}
                                        >
                                            {t('vehicles.encumbrance.requestRelease')}
                                        </Button>
                                    )}
                                    {mayRelease && e.status === 'release_pending' && second && (
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                size="sm"
                                                data-confirm-release={e.id}
                                                onClick={() => setAction({ what: 'confirm', row: e })}
                                            >
                                                {t('vehicles.encumbrance.confirmRelease')}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                data-refuse-release={e.id}
                                                onClick={() => setAction({ what: 'refuse', row: e })}
                                            >
                                                {t('vehicles.encumbrance.refuseRelease')}
                                            </Button>
                                        </div>
                                    )}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
            {action?.what === 'request' && <RequestDialog row={action.row} onClose={() => setAction(undefined)} />}
            {action?.what === 'confirm' && <ConfirmDialog row={action.row} onClose={() => setAction(undefined)} />}
            {action?.what === 'refuse' && <RefuseDialog row={action.row} onClose={() => setAction(undefined)} />}
        </>
    );
}

function Problem({ message }: { message: string | undefined }) {
    if (!message) return null;
    return (
        <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
        </Alert>
    );
}

function RequestDialog({ row, onClose }: { row: Encumbrance; onClose: () => void }) {
    const { t } = useText();
    const notify = useNotify();
    const request = useRequestRelease(row);
    const [problem, setProblem] = useState<string>();
    const schema = useMemo(
        () =>
            z.object({
                releaseReference: z.string().refine((v) => v.trim() !== '', t('vehicles.encumbrance.required')),
                releaseDate: z.string().refine((v) => v !== '', t('vehicles.encumbrance.required')),
                note: z.string().max(500)
            }),
        [t]
    );
    const form = useZodForm({
        schema,
        defaultValues: { releaseReference: '', releaseDate: '', note: '' },
        onSubmit: async (v) => {
            setProblem(undefined);
            const parsed = releaseRequestSchema.safeParse({
                releaseReference: v.releaseReference,
                releaseDate: v.releaseDate,
                note: v.note.trim() === '' ? undefined : v.note
            });
            if (!parsed.success) {
                setProblem(t('vehicles.encumbrance.actionFailed'));
                return;
            }
            try {
                await request.mutateAsync(parsed.data);
                notify.success(t('vehicles.encumbrance.releaseRequested'));
                onClose();
            } catch (error) {
                setProblem(getApiErrorMessage(error, t('vehicles.encumbrance.actionFailed')));
            }
        }
    });
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-request-dialog={row.id}>
                <DialogHeader>
                    <DialogTitle>{t('vehicles.encumbrance.requestRelease')}</DialogTitle>
                    <DialogDescription>{t('vehicles.encumbrance.requestIntro')}</DialogDescription>
                </DialogHeader>
                <ZodForm form={form} className="flex flex-col gap-4">
                    <form.AppField name="releaseReference">
                        {(f) => <f.TextField label={t('vehicles.encumbrance.releaseReference')} autoComplete="off" />}
                    </form.AppField>
                    <form.Field name="releaseDate">
                        {(field) => (
                            <DateField
                                id="releaseDate"
                                label={t('vehicles.encumbrance.releaseDate')}
                                value={field.state.value}
                                onChange={field.handleChange}
                            />
                        )}
                    </form.Field>
                    <form.AppField name="note">
                        {(f) => <f.TextField label={t('vehicles.encumbrance.note')} />}
                    </form.AppField>
                    <Problem message={problem} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            {t('vehicles.encumbrance.cancel')}
                        </Button>
                        <form.AppForm>
                            <form.SubmitButton>{t('vehicles.encumbrance.requestRelease')}</form.SubmitButton>
                        </form.AppForm>
                    </DialogFooter>
                </ZodForm>
            </DialogContent>
        </Dialog>
    );
}

function ConfirmDialog({ row, onClose }: { row: Encumbrance; onClose: () => void }) {
    const { t } = useText();
    const notify = useNotify();
    const confirm = useConfirmRelease(row);
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-confirm-dialog={row.id}>
                <DialogHeader>
                    <DialogTitle>{t('vehicles.encumbrance.confirmRelease')}</DialogTitle>
                    <DialogDescription>{t('vehicles.encumbrance.confirmIntro')}</DialogDescription>
                </DialogHeader>
                <div className="text-sm">
                    {row.releaseReference} · {row.releaseDate}
                </div>
                {confirm.error && (
                    <Problem message={getApiErrorMessage(confirm.error, t('vehicles.encumbrance.actionFailed'))} />
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('vehicles.encumbrance.cancel')}
                    </Button>
                    <Button
                        disabled={confirm.isPending}
                        data-confirm-submit
                        onClick={() =>
                            confirm.mutate(undefined, {
                                onSuccess: () => {
                                    notify.success(t('vehicles.encumbrance.releaseConfirmed'));
                                    onClose();
                                }
                            })
                        }
                    >
                        {t('vehicles.encumbrance.confirmRelease')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RefuseDialog({ row, onClose }: { row: Encumbrance; onClose: () => void }) {
    const { t } = useText();
    const notify = useNotify();
    const refuse = useRefuseRelease(row);
    const [problem, setProblem] = useState<string>();
    const schema = useMemo(
        () =>
            z.object({
                reason: z
                    .string()
                    .refine(
                        (v) => v.trim().length >= 10 && v.trim().length <= 500,
                        t('vehicles.encumbrance.reasonHint')
                    )
            }),
        [t]
    );
    const form = useZodForm({
        schema,
        defaultValues: { reason: '' },
        onSubmit: async (v) => {
            setProblem(undefined);
            try {
                await refuse.mutateAsync({ reason: v.reason.trim() });
                notify.success(t('vehicles.encumbrance.releaseRefused'));
                onClose();
            } catch (error) {
                setProblem(getApiErrorMessage(error, t('vehicles.encumbrance.actionFailed')));
            }
        }
    });
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent data-refuse-dialog={row.id}>
                <DialogHeader>
                    <DialogTitle>{t('vehicles.encumbrance.refuseRelease')}</DialogTitle>
                    <DialogDescription>{t('vehicles.encumbrance.refuseIntro')}</DialogDescription>
                </DialogHeader>
                <ZodForm form={form} className="flex flex-col gap-4">
                    <form.AppField name="reason">
                        {(f) => (
                            <f.TextareaField
                                label={t('vehicles.encumbrance.reason')}
                                description={t('vehicles.encumbrance.reasonHint')}
                                maxLength={500}
                            />
                        )}
                    </form.AppField>
                    <Problem message={problem} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            {t('vehicles.encumbrance.cancel')}
                        </Button>
                        <form.AppForm>
                            <form.SubmitButton>{t('vehicles.encumbrance.refuseRelease')}</form.SubmitButton>
                        </form.AppForm>
                    </DialogFooter>
                </ZodForm>
            </DialogContent>
        </Dialog>
    );
}

/** Records a hold on a vehicle: the holder is an organisation of the register, picked by name or TIN. */
export function RecordEncumbrance({ vehicleId }: { vehicleId: string }) {
    const { t, text } = useText();
    const notify = useNotify();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [problem, setProblem] = useState<string>();
    const found = useOrganisations(search);
    const record = useRecordEncumbrance();
    const options = (found.data ?? []).map((o) => ({ value: o.id, label: text({ ...o.name }) }));
    const schema = useMemo(
        () =>
            z.object({
                kind: z.string().refine((v) => v !== '', t('vehicles.encumbrance.required')),
                holder: z.string().refine((v) => v !== '', t('vehicles.encumbrance.required')),
                letterReference: z.string().refine((v) => v.trim() !== '', t('vehicles.encumbrance.required')),
                letterDate: z.string().refine((v) => v !== '', t('vehicles.encumbrance.required')),
                amount: z
                    .string()
                    .refine(
                        (v) => v.trim() === '' || birrToSantim(v) !== null,
                        t('vehicles.encumbrance.amountInvalid')
                    ),
                note: z.string().max(500)
            }),
        [t]
    );
    const form = useZodForm({
        schema,
        defaultValues: { kind: '', holder: '', letterReference: '', letterDate: '', amount: '', note: '' },
        onSubmit: async (v) => {
            setProblem(undefined);
            const parsed = encumbranceRecordSchema.safeParse({
                vehicleId,
                kind: v.kind,
                holderOrganisationId: v.holder,
                letterReference: v.letterReference,
                letterDate: v.letterDate,
                amountSantim: v.amount.trim() === '' ? undefined : (birrToSantim(v.amount) ?? undefined),
                note: v.note.trim() === '' ? undefined : v.note
            });
            if (!parsed.success) {
                setProblem(t('vehicles.encumbrance.actionFailed'));
                return;
            }
            try {
                await record.mutateAsync(parsed.data);
                notify.success(t('vehicles.encumbrance.recorded'));
                setOpen(false);
            } catch (error) {
                setProblem(getApiErrorMessage(error, t('vehicles.encumbrance.actionFailed')));
            }
        }
    });
    return (
        <>
            <Button data-record-encumbrance onClick={() => setOpen(true)}>
                {t('vehicles.encumbrance.record')}
            </Button>
            {open && (
                <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
                    <DialogContent data-record-dialog>
                        <DialogHeader>
                            <DialogTitle>{t('vehicles.encumbrance.record')}</DialogTitle>
                            <DialogDescription>{t('vehicles.encumbrance.recordIntro')}</DialogDescription>
                        </DialogHeader>
                        <ZodForm form={form} className="flex flex-col gap-4">
                            <form.AppField name="kind">
                                {(f) => (
                                    <f.SelectField
                                        label={t('vehicles.encumbrance.kindLabel')}
                                        placeholder={t('vehicles.encumbrance.pickHolder')}
                                        options={ENCUMBRANCE_KINDS.map((k) => ({
                                            value: k,
                                            label: t(`vehicles.encumbrance.kind.${k}`)
                                        }))}
                                    />
                                )}
                            </form.AppField>
                            <form.Field name="holder">
                                {(field) => (
                                    <div className="flex flex-col gap-2">
                                        <Label>{t('vehicles.encumbrance.holder')}</Label>
                                        <Combobox
                                            aria-label={t('vehicles.encumbrance.holder')}
                                            options={options}
                                            value={field.state.value || null}
                                            fallbackLabel={options.find((o) => o.value === field.state.value)?.label}
                                            onChange={(id) => field.handleChange(typeof id === 'string' ? id : '')}
                                            onSearchChange={setSearch}
                                            placeholder={t('vehicles.encumbrance.pickHolder')}
                                            searchPlaceholder={t('vehicles.encumbrance.searchHolder')}
                                            emptyMessage={t('vehicles.encumbrance.noHolderFound')}
                                        />
                                    </div>
                                )}
                            </form.Field>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <form.AppField name="letterReference">
                                    {(f) => (
                                        <f.TextField
                                            label={t('vehicles.encumbrance.letterReference')}
                                            autoComplete="off"
                                        />
                                    )}
                                </form.AppField>
                                <form.Field name="letterDate">
                                    {(field) => (
                                        <DateField
                                            id="letterDate"
                                            label={t('vehicles.encumbrance.letterDate')}
                                            value={field.state.value}
                                            onChange={field.handleChange}
                                        />
                                    )}
                                </form.Field>
                            </div>
                            <form.AppField name="amount">
                                {(f) => (
                                    <f.TextField
                                        label={t('vehicles.encumbrance.amount')}
                                        description={t('vehicles.encumbrance.amountHint')}
                                        inputMode="decimal"
                                    />
                                )}
                            </form.AppField>
                            <form.AppField name="note">
                                {(f) => <f.TextField label={t('vehicles.encumbrance.note')} />}
                            </form.AppField>
                            <Problem message={problem} />
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                                    {t('vehicles.encumbrance.cancel')}
                                </Button>
                                <form.AppForm>
                                    <form.SubmitButton>{t('vehicles.encumbrance.recordSubmit')}</form.SubmitButton>
                                </form.AppForm>
                            </DialogFooter>
                        </ZodForm>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
