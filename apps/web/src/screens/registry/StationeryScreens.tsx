'use client';

/**
 * Controlled stationery (task 1.12a; ADR-0050): an office's stock of serial-numbered forms by kind (libre booklets, licence
 * blanks, bolo stickers, receipt leaves). The overview shows the counts of the office and of the offices directly under it,
 * whether each ledger agrees, the allocations waiting for this office, and its closings; the keeper receives a delivery,
 * allocates a run to an office below, and the office closes its day's count: what it should hold and did not count is
 * flagged missing.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
    stationeryAllocationSchema,
    stationeryClosingSchema,
    stationeryReceiveSchema,
    type StationeryRange
} from '@itrms/fees/contracts';
import {
    Alert,
    AlertDescription,
    Button,
    EmptyState,
    EthiopianDatePicker,
    Input,
    Label,
    PageHeader,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useZodForm,
    ZodForm
} from '@itrms/ui';
import { z } from 'zod';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { formatDay } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import {
    STATIONERY_KINDS,
    isStationeryKind,
    useAcceptStationery,
    useAllocateStationery,
    useCloseStationery,
    useReceiveStationery,
    useStationeryClosings,
    useStationeryMovements,
    useStationerySummary,
    type StationeryClosing,
    type StationeryKind,
    type StationeryMovement,
    type StationerySummaryRow
} from '@/lib/stationery';

const BASE = '/registry/stationery';
const addisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

/** The kind the screen is on: `?kind=`, by default the first. */
function useKind(): StationeryKind {
    const params = useSearchParams();
    const kind = params.get('kind');
    return isStationeryKind(kind) ? kind : 'libre_booklet';
}

function useCan(permission: string): boolean {
    return useAuthStore((s) => s.workspace?.permissions.includes(permission) ?? false);
}

function KindPicker({ kind }: { kind: StationeryKind }) {
    const { t } = useText();
    return (
        <nav className="flex flex-wrap gap-2" aria-label={t('fees.stationery.kindLabel')} data-kinds>
            {STATIONERY_KINDS.map((k) => (
                <Button key={k} asChild size="sm" variant={k === kind ? 'default' : 'outline'}>
                    <Link href={`${BASE}?kind=${k}`} data-kind={k} aria-current={k === kind ? 'page' : undefined}>
                        {t(`fees.stationery.kind.${k}`)}
                    </Link>
                </Button>
            ))}
        </nav>
    );
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
    onChange: (value: string) => void;
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
                max={addisToday()}
                labels={{
                    placeholder: t('fees.stationery.pickDate'),
                    previousMonth: t('fees.payment.previousMonth'),
                    nextMonth: t('fees.payment.nextMonth'),
                    clear: t('fees.payment.clear'),
                    month: t('fees.payment.month'),
                    year: t('fees.payment.year')
                }}
            />
            {calendar === 'gregorian' && value && <span className="text-muted-foreground text-xs">{value}</span>}
        </div>
    );
}

function AcceptButton({ movement }: { movement: StationeryMovement }) {
    const { t } = useText();
    const accept = useAcceptStationery(movement.id);
    return (
        <div className="flex flex-col items-end gap-1">
            <Button size="sm" data-accept={movement.id} disabled={accept.isPending} onClick={() => accept.mutate({})}>
                {t('fees.stationery.accept')}
            </Button>
            {accept.error && (
                <span className="text-destructive text-xs">
                    {getApiErrorMessage(accept.error, t('fees.stationery.actionFailed'))}
                </span>
            )}
        </div>
    );
}

function ClosingLine({ closing }: { closing: StationeryClosing }) {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    return (
        <li className="flex flex-col gap-1 rounded-md border p-3" data-closing={closing.closedOn}>
            <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">{formatDay(closing.closedOn, { language, calendar })}</span>
                <span data-balanced={String(closing.balanced)}>
                    <StatusBadge
                        value={String(closing.balanced)}
                        tone={closing.balanced ? 'success' : 'danger'}
                        label={t(closing.balanced ? 'fees.stationery.balanced' : 'fees.stationery.flagged')}
                    />
                </span>
            </div>
            <span className="text-muted-foreground text-sm">
                {t('fees.stationery.closingCounts', {
                    expected: String(closing.expected),
                    counted: String(closing.counted)
                })}
            </span>
            {closing.missingCount > 0 && (
                <span className="text-destructive text-sm" data-missing>
                    {t('fees.stationery.missingList', { count: String(closing.missingCount) })}{' '}
                    {closing.missing.join(', ')}
                </span>
            )}
            {closing.unexpectedCount > 0 && (
                <span className="text-sm text-amber-700 dark:text-amber-400" data-unexpected>
                    {t('fees.stationery.unexpectedList', { count: String(closing.unexpectedCount) })}{' '}
                    {closing.unexpected.join(', ')}
                </span>
            )}
        </li>
    );
}

export function StationeryOverview() {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const kind = useKind();
    const canReceive = useCan('stationery:receive');
    const canAllocate = useCan('stationery:allocate');
    const canClose = useCan('stationery:close');
    const activeUnitId = useAuthStore((s) => s.workspace?.activeUnit.id);
    const summary = useStationerySummary(kind);
    const movements = useStationeryMovements({ kind, limit: 20 });
    const sentHere = useStationeryMovements({ kind, movement: 'allocate', unitId: activeUnitId, limit: 100 });
    const closings = useStationeryClosings(kind);

    const unitName = (name: Record<string, string>) => text({ am: '', en: '', ...name });
    const day = (value: string) => formatDay(value, { language, calendar });
    const range = (m: StationeryMovement) => (m.firstKey === m.lastKey ? m.firstKey : `${m.firstKey} – ${m.lastKey}`);

    const header = (
        <PageHeader
            title={t('fees.stationery.title')}
            description={t('fees.stationery.intro')}
            actions={
                <>
                    {canReceive && (
                        <Button asChild>
                            <Link href={`${BASE}/receive?kind=${kind}`}>{t('fees.stationery.receive')}</Link>
                        </Button>
                    )}
                    {canAllocate && (
                        <Button asChild variant="outline">
                            <Link href={`${BASE}/allocate?kind=${kind}`}>{t('fees.stationery.allocate')}</Link>
                        </Button>
                    )}
                    {canClose && (
                        <Button asChild variant="outline">
                            <Link href={`${BASE}/closing?kind=${kind}`} data-action="close">
                                {t('fees.stationery.close')}
                            </Link>
                        </Button>
                    )}
                </>
            }
        />
    );

    let body: React.ReactNode;
    if (summary.isPending) body = <Skeleton className="h-48 w-full" />;
    else if (summary.error || !summary.data)
        body = (
            <Alert variant="destructive">
                <AlertDescription>
                    {getApiErrorMessage(summary.error, t('fees.stationery.loadFailed'))}
                </AlertDescription>
            </Alert>
        );
    else {
        const active = summary.data.unit;
        const rows: StationerySummaryRow[] = [active, ...summary.data.children];
        const waiting = (sentHere.data ?? []).filter(
            (m) => m.movement === 'allocate' && m.toUnit?.id === active.unit.id && (m.awaiting ?? 0) > 0
        );
        body = (
            <>
                <Table data-counts>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('fees.stationery.col.unit')}</TableHead>
                            <TableHead>{t('fees.stationery.col.received')}</TableHead>
                            <TableHead>{t('fees.stationery.col.inStock')}</TableHead>
                            <TableHead>{t('fees.stationery.col.inTransit')}</TableHead>
                            <TableHead>{t('fees.stationery.col.used')}</TableHead>
                            <TableHead>{t('fees.stationery.col.ended')}</TableHead>
                            <TableHead>{t('fees.stationery.col.allocatedDown')}</TableHead>
                            <TableHead>{t('fees.stationery.col.ledger')}</TableHead>
                            <TableHead>{t('fees.stationery.col.lastClosing')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.unit.id} data-unit={row.unit.code}>
                                <TableCell className="font-medium">{unitName(row.unit.name)}</TableCell>
                                <TableCell>{row.received}</TableCell>
                                <TableCell data-in-stock>{row.inStock}</TableCell>
                                <TableCell>{row.inTransit}</TableCell>
                                <TableCell data-used>{row.used}</TableCell>
                                <TableCell>{row.spoiled + row.void + row.missing}</TableCell>
                                <TableCell>{row.allocatedDown}</TableCell>
                                <TableCell>
                                    <span data-reconciled={String(row.reconciled)}>
                                        <StatusBadge
                                            value={String(row.reconciled)}
                                            tone={row.reconciled ? 'success' : 'danger'}
                                            label={t(
                                                row.reconciled
                                                    ? 'fees.stationery.reconciled'
                                                    : 'fees.stationery.notReconciled'
                                            )}
                                        />
                                    </span>
                                </TableCell>
                                <TableCell>
                                    {row.lastClosing ? (
                                        <StatusBadge
                                            value={String(row.lastClosing.balanced)}
                                            tone={row.lastClosing.balanced ? 'success' : 'danger'}
                                            label={`${day(row.lastClosing.closedOn)} · ${t(
                                                row.lastClosing.balanced
                                                    ? 'fees.stationery.balanced'
                                                    : 'fees.stationery.flagged'
                                            )}`}
                                        />
                                    ) : (
                                        '—'
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <section className="flex flex-col gap-3" data-waiting>
                    <h2 className="text-lg font-semibold">{t('fees.stationery.waiting')}</h2>
                    {waiting.length === 0 ? (
                        <p className="text-muted-foreground text-sm">{t('fees.stationery.noneWaiting')}</p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {waiting.map((m) => (
                                <li
                                    key={m.id}
                                    className="flex items-center justify-between gap-4 rounded-md border p-3"
                                >
                                    <span className="text-sm">
                                        {day(m.occurredOn)} · {m.fromUnit ? unitName(m.fromUnit.name) : '—'} ·{' '}
                                        {m.awaiting} · {range(m)}
                                    </span>
                                    {canReceive && <AcceptButton movement={m} />}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="flex flex-col gap-3" data-closings>
                    <h2 className="text-lg font-semibold">{t('fees.stationery.closings')}</h2>
                    {closings.data?.length ? (
                        <ul className="flex flex-col gap-2">
                            {closings.data.map((c) => (
                                <ClosingLine key={c.id} closing={c} />
                            ))}
                        </ul>
                    ) : (
                        <p className="text-muted-foreground text-sm">{t('fees.stationery.noClosings')}</p>
                    )}
                </section>

                <section className="flex flex-col gap-3">
                    <h2 className="text-lg font-semibold">{t('fees.stationery.movements')}</h2>
                    {movements.data?.length === 0 && <EmptyState title={t('fees.stationery.noMovements')} />}
                    {movements.data && movements.data.length > 0 && (
                        <Table data-movements>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('fees.stationery.col.date')}</TableHead>
                                    <TableHead>{t('fees.stationery.col.movement')}</TableHead>
                                    <TableHead>{t('fees.stationery.col.units')}</TableHead>
                                    <TableHead>{t('fees.stationery.col.quantity')}</TableHead>
                                    <TableHead>{t('fees.stationery.col.serials')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {movements.data.map((m) => (
                                    <TableRow key={m.id} data-movement={m.movement}>
                                        <TableCell>{day(m.occurredOn)}</TableCell>
                                        <TableCell>{t(`fees.stationery.movement.${m.movement}`)}</TableCell>
                                        <TableCell>
                                            {m.fromUnit || m.toUnit
                                                ? `${m.fromUnit ? unitName(m.fromUnit.name) : '—'} → ${m.toUnit ? unitName(m.toUnit.name) : '—'}`
                                                : unitName(m.unit.name)}
                                        </TableCell>
                                        <TableCell>{m.quantity}</TableCell>
                                        <TableCell>{range(m)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </section>
            </>
        );
    }

    return (
        <div className="flex flex-col gap-6" data-screen="stationery" data-kind={kind}>
            {header}
            <KindPicker kind={kind} />
            {body}
        </div>
    );
}

const serialText = /^\d{1,8}$/;

function rangeFields(t: (key: string) => string) {
    return {
        series: z.string().refine((v) => /^[A-Za-z\s-]{0,8}$/.test(v), t('fees.stationery.seriesHint')),
        from: z.string().refine((v) => serialText.test(v.trim()), t('fees.stationery.serialHint')),
        to: z.string().refine((v) => serialText.test(v.trim()), t('fees.stationery.serialHint'))
    };
}

function asRange(v: { series: string; from: string; to: string }) {
    return { series: v.series, from: Number(v.from.trim()), to: Number(v.to.trim()) };
}

function CommandScreen({
    screen,
    title,
    intro,
    problem,
    children
}: {
    screen: string;
    title: string;
    intro: string;
    problem?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex max-w-3xl flex-col gap-6" data-screen={screen}>
            <PageHeader title={title} description={intro} />
            {children}
            {problem && (
                <Alert variant="destructive">
                    <AlertDescription data-problem>{problem}</AlertDescription>
                </Alert>
            )}
        </div>
    );
}

export function StationeryReceive() {
    const { t } = useText();
    const router = useRouter();
    const kind = useKind();
    const receive = useReceiveStationery();
    const [problem, setProblem] = useState<string>();
    const schema = useMemo(
        () =>
            z.object({
                reference: z.string().refine((v) => v.trim() !== '', t('fees.stationery.required')),
                receivedOn: z.string().refine((v) => v !== '', t('fees.stationery.required')),
                ...rangeFields(t),
                variant: z.string().refine((v) => /^[a-z0-9_]{0,20}$/.test(v.trim()), t('fees.stationery.variantHint')),
                validEfy: z.string().refine((v) => /^(|\d{4})$/.test(v.trim()), t('fees.stationery.yearHint')),
                unitCost: z
                    .string()
                    .refine((v) => /^(|\d{1,9}(\.\d{1,2})?)$/.test(v.trim()), t('fees.stationery.costHint')),
                note: z.string().max(500)
            }),
        [t]
    );
    const form = useZodForm({
        schema,
        defaultValues: {
            reference: '',
            receivedOn: '',
            series: '',
            from: '',
            to: '',
            variant: '',
            validEfy: '',
            unitCost: '',
            note: ''
        },
        onSubmit: async (v) => {
            setProblem(undefined);
            const cost = v.unitCost.trim();
            const [birr = '0', cents = ''] = cost.split('.');
            const parsed = stationeryReceiveSchema.safeParse({
                kind,
                source: 'regional_bureau',
                reference: v.reference.trim(),
                receivedOn: v.receivedOn,
                range: asRange(v),
                variant: v.variant.trim() || undefined,
                validEfy: v.validEfy.trim() ? Number(v.validEfy.trim()) : undefined,
                // Birr to santim as text: the digits of the Birr, then exactly two of the cents
                unitCostSantim: cost ? `${birr}${cents.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '') : undefined,
                note: v.note.trim() || undefined
            });
            if (!parsed.success) {
                setProblem(t('fees.stationery.invalid'));
                return;
            }
            try {
                await receive.mutateAsync(parsed.data);
                router.push(`${BASE}?kind=${kind}`);
            } catch (error) {
                setProblem(getApiErrorMessage(error, t('fees.stationery.actionFailed')));
            }
        }
    });
    return (
        <CommandScreen
            screen="stationery-receive"
            title={`${t('fees.stationery.receive')} · ${t(`fees.stationery.kind.${kind}`)}`}
            intro={t('fees.stationery.receiveIntro')}
            problem={problem}
        >
            <ZodForm form={form} className="flex flex-col gap-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <form.AppField name="reference">
                        {(f) => <f.TextField label={t('fees.stationery.field.reference')} autoComplete="off" />}
                    </form.AppField>
                    <form.Field name="receivedOn">
                        {(field) => (
                            <DateField
                                id="receivedOn"
                                label={t('fees.stationery.field.receivedOn')}
                                value={field.state.value}
                                onChange={field.handleChange}
                            />
                        )}
                    </form.Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                    <form.AppField name="series">
                        {(f) => (
                            <f.TextField
                                label={t('fees.stationery.field.series')}
                                description={t('fees.stationery.seriesHint')}
                                autoComplete="off"
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="from">
                        {(f) => <f.TextField label={t('fees.stationery.field.from')} inputMode="numeric" />}
                    </form.AppField>
                    <form.AppField name="to">
                        {(f) => <f.TextField label={t('fees.stationery.field.to')} inputMode="numeric" />}
                    </form.AppField>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                    <form.AppField name="variant">
                        {(f) => (
                            <f.TextField
                                label={t('fees.stationery.field.variant')}
                                description={t('fees.stationery.variantHint')}
                                autoComplete="off"
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="validEfy">
                        {(f) => (
                            <f.TextField
                                label={t('fees.stationery.field.validEfy')}
                                description={t('fees.stationery.yearHint')}
                                inputMode="numeric"
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="unitCost">
                        {(f) => (
                            <f.TextField
                                label={t('fees.stationery.field.unitCost')}
                                description={t('fees.stationery.costHint')}
                                inputMode="decimal"
                            />
                        )}
                    </form.AppField>
                </div>
                <form.AppField name="note">
                    {(f) => <f.TextField label={t('fees.stationery.field.note')} />}
                </form.AppField>
                <div className="flex gap-2">
                    <form.AppForm>
                        <form.SubmitButton>{t('fees.stationery.receiveSubmit')}</form.SubmitButton>
                    </form.AppForm>
                    <Button type="button" variant="ghost" onClick={() => router.back()}>
                        {t('fees.stationery.cancel')}
                    </Button>
                </div>
            </ZodForm>
        </CommandScreen>
    );
}

export function StationeryAllocate() {
    const { t, text } = useText();
    const router = useRouter();
    const kind = useKind();
    const summary = useStationerySummary(kind);
    const allocate = useAllocateStationery();
    const [problem, setProblem] = useState<string>();
    const schema = useMemo(
        () =>
            z.object({
                toUnit: z.string().refine((v) => v !== '', t('fees.stationery.required')),
                ...rangeFields(t),
                note: z.string().max(500)
            }),
        [t]
    );
    const form = useZodForm({
        schema,
        defaultValues: { toUnit: '', series: '', from: '', to: '', note: '' },
        onSubmit: async (v) => {
            setProblem(undefined);
            const parsed = stationeryAllocationSchema.safeParse({
                kind,
                toUnitId: v.toUnit,
                items: asRange(v),
                note: v.note.trim() || undefined
            });
            if (!parsed.success) {
                setProblem(t('fees.stationery.invalid'));
                return;
            }
            try {
                await allocate.mutateAsync(parsed.data);
                router.push(`${BASE}?kind=${kind}`);
            } catch (error) {
                setProblem(getApiErrorMessage(error, t('fees.stationery.actionFailed')));
            }
        }
    });
    if (summary.isPending) return <Skeleton className="h-48 w-full" />;
    const options = (summary.data?.children ?? [])
        .filter((row) => row.holdsStationery)
        .map((row) => ({ value: row.unit.id, label: text({ am: '', en: '', ...row.unit.name }) }));
    return (
        <CommandScreen
            screen="stationery-allocate"
            title={`${t('fees.stationery.allocate')} · ${t(`fees.stationery.kind.${kind}`)}`}
            intro={t('fees.stationery.allocateIntro')}
            problem={problem}
        >
            {summary.data && options.length === 0 && (
                <Alert>
                    <AlertDescription>{t('fees.stationery.noneBelow')}</AlertDescription>
                </Alert>
            )}
            <ZodForm form={form} className="flex flex-col gap-6">
                <form.AppField name="toUnit">
                    {(f) => (
                        <f.SelectField
                            label={t('fees.stationery.field.toUnit')}
                            placeholder={t('fees.stationery.choose')}
                            options={options}
                        />
                    )}
                </form.AppField>
                <div className="grid gap-4 sm:grid-cols-3">
                    <form.AppField name="series">
                        {(f) => <f.TextField label={t('fees.stationery.field.series')} autoComplete="off" />}
                    </form.AppField>
                    <form.AppField name="from">
                        {(f) => <f.TextField label={t('fees.stationery.field.from')} inputMode="numeric" />}
                    </form.AppField>
                    <form.AppField name="to">
                        {(f) => <f.TextField label={t('fees.stationery.field.to')} inputMode="numeric" />}
                    </form.AppField>
                </div>
                <form.AppField name="note">
                    {(f) => <f.TextField label={t('fees.stationery.field.note')} />}
                </form.AppField>
                <div className="flex gap-2">
                    <form.AppForm>
                        <form.SubmitButton>{t('fees.stationery.allocateSubmit')}</form.SubmitButton>
                    </form.AppForm>
                    <Button type="button" variant="ghost" onClick={() => router.back()}>
                        {t('fees.stationery.cancel')}
                    </Button>
                </div>
            </ZodForm>
        </CommandScreen>
    );
}

/** One run of the closing's count, as typed: series, first and last serial. */
interface CountedRun {
    series: string;
    from: string;
    to: string;
}

export function StationeryClosingScreen() {
    const { t } = useText();
    const kind = useKind();
    const close = useCloseStationery();
    const [closedOn, setClosedOn] = useState(addisToday());
    const [runs, setRuns] = useState<CountedRun[]>([{ series: '', from: '', to: '' }]);
    const [note, setNote] = useState('');
    const [problem, setProblem] = useState<string>();
    const [result, setResult] = useState<StationeryClosing>();

    const setRun = (i: number, patch: Partial<CountedRun>) =>
        setRuns((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

    const submit = async () => {
        setProblem(undefined);
        setResult(undefined);
        const filled = runs.filter((r) => r.from.trim() !== '' || r.to.trim() !== '');
        const counted: StationeryRange[] = [];
        for (const r of filled) {
            if (!serialText.test(r.from.trim()) || !serialText.test(r.to.trim())) {
                setProblem(t('fees.stationery.serialHint'));
                return;
            }
            counted.push(asRange(r) as StationeryRange);
        }
        const parsed = stationeryClosingSchema.safeParse({
            kind,
            closedOn,
            counted,
            note: note.trim() || undefined
        });
        if (!parsed.success) {
            setProblem(t('fees.stationery.invalid'));
            return;
        }
        try {
            setResult(await close.mutateAsync(parsed.data));
        } catch (error) {
            setProblem(getApiErrorMessage(error, t('fees.stationery.actionFailed')));
        }
    };

    return (
        <CommandScreen
            screen="stationery-closing"
            title={`${t('fees.stationery.close')} · ${t(`fees.stationery.kind.${kind}`)}`}
            intro={t('fees.stationery.closeIntro')}
            problem={problem}
        >
            <DateField
                id="closedOn"
                label={t('fees.stationery.field.closedOn')}
                value={closedOn}
                onChange={setClosedOn}
            />
            <fieldset className="flex flex-col gap-3" data-counted>
                <legend className="mb-2 text-sm font-medium">{t('fees.stationery.counted')}</legend>
                {runs.map((r, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-3" data-run={i}>
                        <Input
                            aria-label={t('fees.stationery.field.series')}
                            value={r.series}
                            placeholder={t('fees.stationery.field.series')}
                            onChange={(e) => setRun(i, { series: e.target.value })}
                        />
                        <Input
                            aria-label={t('fees.stationery.field.from')}
                            inputMode="numeric"
                            value={r.from}
                            placeholder={t('fees.stationery.field.from')}
                            onChange={(e) => setRun(i, { from: e.target.value })}
                        />
                        <Input
                            aria-label={t('fees.stationery.field.to')}
                            inputMode="numeric"
                            value={r.to}
                            placeholder={t('fees.stationery.field.to')}
                            onChange={(e) => setRun(i, { to: e.target.value })}
                        />
                    </div>
                ))}
                <div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRuns((all) => [...all, { series: '', from: '', to: '' }])}
                    >
                        {t('fees.stationery.addRun')}
                    </Button>
                </div>
            </fieldset>
            <div className="flex flex-col gap-2">
                <Label htmlFor="closing-note">{t('fees.stationery.field.note')}</Label>
                <Input id="closing-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex gap-2">
                <Button type="button" data-action="close-submit" disabled={close.isPending} onClick={submit}>
                    {t('fees.stationery.closeSubmit')}
                </Button>
                <Button asChild variant="ghost">
                    <Link href={`${BASE}?kind=${kind}`}>{t('fees.stationery.back')}</Link>
                </Button>
            </div>
            {result && (
                <ul data-result>
                    <ClosingLine closing={result} />
                </ul>
            )}
        </CommandScreen>
    );
}
