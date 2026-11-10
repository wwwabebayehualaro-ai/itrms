'use client';

/**
 * The plate stock of the active office (task 1.2a): the counts of the office and of the offices directly under it, whether
 * each ledger agrees with what the office holds, the allocations waiting for this office to accept them, and the latest
 * movements. Receiving a delivery and allocating plates are separate screens, shown to the offices that may do them.
 */
import Link from 'next/link';
import { nationalPlateText } from '@itrms/vehicles/contracts';
import {
    Alert,
    AlertDescription,
    Button,
    EmptyState,
    PageHeader,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { formatDay } from '@/lib/format';
import {
    useAcceptAllocation,
    useStockMovements,
    useStockSummary,
    type PlateMovement,
    type StockSummaryRow
} from '@/lib/plate-stock';
import { usePreferences, useText } from '@/lib/preferences';

function AcceptButton({ movement }: { movement: PlateMovement }) {
    const { t } = useText();
    const accept = useAcceptAllocation(movement.id);
    return (
        <div className="flex flex-col items-end gap-1">
            <Button size="sm" data-accept={movement.id} disabled={accept.isPending} onClick={() => accept.mutate({})}>
                {t('vehicles.plateStock.accept')}
            </Button>
            {accept.error && (
                <span className="text-destructive text-xs">
                    {getApiErrorMessage(accept.error, t('vehicles.plateStock.acceptFailed'))}
                </span>
            )}
        </div>
    );
}

export function PlateStockOverview() {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const permissions = useAuthStore((s) => s.workspace?.permissions);
    const canReceive = permissions?.includes('plate-stock:receive') ?? false;
    const canAllocate = permissions?.includes('plate-stock:allocate') ?? false;
    const summary = useStockSummary();
    const movements = useStockMovements({ limit: 20 });

    const unitName = (name: Record<string, string>) => text({ am: '', en: '', ...name });
    const day = (value: string) => formatDay(value, { language, calendar });
    const range = (m: PlateMovement) =>
        m.firstKey === m.lastKey
            ? nationalPlateText(m.firstKey)
            : `${nationalPlateText(m.firstKey)} – ${nationalPlateText(m.lastKey)}`;

    const header = (
        <PageHeader
            title={t('vehicles.plateStock.title')}
            description={t('vehicles.plateStock.intro')}
            actions={
                <>
                    {canReceive && (
                        <Button asChild>
                            <Link href="/registry/plate-stock/receive">{t('vehicles.plateStock.receive')}</Link>
                        </Button>
                    )}
                    {canAllocate && (
                        <Button asChild variant="outline">
                            <Link href="/registry/plate-stock/allocate">{t('vehicles.plateStock.allocate')}</Link>
                        </Button>
                    )}
                </>
            }
        />
    );

    if (summary.isPending) return <Skeleton className="h-48 w-full" />;
    if (summary.error || !summary.data)
        return (
            <div className="flex flex-col gap-6" data-screen="plate-stock">
                {header}
                <Alert variant="destructive">
                    <AlertDescription>
                        {getApiErrorMessage(summary.error, t('vehicles.plateStock.loadFailed'))}
                    </AlertDescription>
                </Alert>
            </div>
        );

    const active = summary.data.unit;
    const rows: StockSummaryRow[] = [active, ...summary.data.children];
    const waiting = (movements.data ?? []).filter(
        (m) => m.kind === 'allocate' && m.toUnit?.id === active.unit.id && (m.awaiting ?? 0) > 0
    );

    return (
        <div className="flex flex-col gap-6" data-screen="plate-stock">
            {header}
            <Table data-counts>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('vehicles.plateStock.counts.unit')}</TableHead>
                        <TableHead>{t('vehicles.plateStock.counts.received')}</TableHead>
                        <TableHead>{t('vehicles.plateStock.counts.inStock')}</TableHead>
                        <TableHead>{t('vehicles.plateStock.counts.inTransit')}</TableHead>
                        <TableHead>{t('vehicles.plateStock.counts.reserved')}</TableHead>
                        <TableHead>{t('vehicles.plateStock.counts.assigned')}</TableHead>
                        <TableHead>{t('vehicles.plateStock.ended')}</TableHead>
                        <TableHead>{t('vehicles.plateStock.counts.allocatedDown')}</TableHead>
                        <TableHead>{t('vehicles.plateStock.counts.ledger')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row) => (
                        <TableRow key={row.unit.id} data-unit={row.unit.code}>
                            <TableCell className="font-medium">{unitName(row.unit.name)}</TableCell>
                            <TableCell>{row.received}</TableCell>
                            <TableCell>{row.inStock}</TableCell>
                            <TableCell>{row.inTransit}</TableCell>
                            <TableCell>{row.reserved}</TableCell>
                            <TableCell>{row.assigned}</TableCell>
                            <TableCell>{row.retired + row.void + row.lost}</TableCell>
                            <TableCell>{row.allocatedDown}</TableCell>
                            <TableCell>
                                <span data-reconciled={String(row.reconciled)}>
                                    <StatusBadge
                                        value={String(row.reconciled)}
                                        tone={row.reconciled ? 'success' : 'danger'}
                                        label={t(
                                            row.reconciled
                                                ? 'vehicles.plateStock.reconciled'
                                                : 'vehicles.plateStock.notReconciled'
                                        )}
                                    />
                                </span>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <section className="flex flex-col gap-3" data-waiting>
                <h2 className="text-lg font-semibold">{t('vehicles.plateStock.waiting')}</h2>
                {waiting.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t('vehicles.plateStock.noneWaiting')}</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {waiting.map((m) => (
                            <li key={m.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
                                <span className="text-sm">
                                    {day(m.occurredOn)} · {m.fromUnit ? unitName(m.fromUnit.name) : '—'} · {m.awaiting}{' '}
                                    · {range(m)}
                                </span>
                                {canReceive && <AcceptButton movement={m} />}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">{t('vehicles.plateStock.movements')}</h2>
                {movements.isPending && <Skeleton className="h-24 w-full" />}
                {movements.error && (
                    <Alert variant="destructive">
                        <AlertDescription>
                            {getApiErrorMessage(movements.error, t('vehicles.plateStock.loadFailed'))}
                        </AlertDescription>
                    </Alert>
                )}
                {movements.data?.length === 0 && <EmptyState title={t('vehicles.plateStock.noMovements')} />}
                {movements.data && movements.data.length > 0 && (
                    <Table data-movements>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('vehicles.plateStock.movement.date')}</TableHead>
                                <TableHead>{t('vehicles.plateStock.movement.kind')}</TableHead>
                                <TableHead>{t('vehicles.plateStock.movement.units')}</TableHead>
                                <TableHead>{t('vehicles.plateStock.movement.quantity')}</TableHead>
                                <TableHead>{t('vehicles.plateStock.movement.plates')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {movements.data.map((m) => (
                                <TableRow key={m.id} data-movement={m.id}>
                                    <TableCell>{day(m.occurredOn)}</TableCell>
                                    <TableCell>{t(`vehicles.plateStock.kind.${m.kind}`)}</TableCell>
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
        </div>
    );
}
