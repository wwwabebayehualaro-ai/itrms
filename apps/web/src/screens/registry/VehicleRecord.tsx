'use client';

/**
 * A vehicle of the register (task 1.1b): its facts, its owners period by period (newest first, in the reader's calendar), the
 * plates it has carried (an old regional plate exchanged for a national one shows both), and its libres. Any office of the
 * region reads it; only the office that handles the vehicle changes it, through a case (later tasks).
 */
import {
    Alert,
    AlertDescription,
    DescriptionList,
    EmptyState,
    PageHeader,
    RecordLayout,
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
import { formatDay } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { useVehicle, type Vehicle } from '@/lib/vehicles';

import { HolderLink, STATUS_TONE } from './vehicle-parts';

export function VehicleRecord({ id }: { id: string }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const vehicle = useVehicle(id);

    if (vehicle.isPending) return <Skeleton className="h-48 w-full" />;
    if (vehicle.error || !vehicle.data)
        return (
            <Alert variant="destructive">
                <AlertDescription>{getApiErrorMessage(vehicle.error, t('vehicles.record.notFound'))}</AlertDescription>
            </Alert>
        );
    const v = vehicle.data;
    const day = (value: string | null) => formatDay(value, { language, calendar });
    const unit = (name: Record<string, string>) => text({ am: '', en: '', ...name });
    const kg = (value: number | null) => (value === null ? null : value.toLocaleString(language));

    return (
        <div className="max-w-5xl" data-screen="vehicle-record">
            <RecordLayout
                header={
                    <PageHeader
                        title={v.currentPlate?.text ?? t('vehicles.record.noPlate')}
                        status={
                            <StatusBadge
                                value={v.status}
                                tone={STATUS_TONE[v.status]}
                                label={t(`vehicles.status.${v.status}`)}
                            />
                        }
                        meta={`${v.make} ${v.model} · ${v.modelYear} · ${text({ am: '', en: '', ...v.category.name })}`}
                    />
                }
                summary={
                    <DescriptionList
                        items={[
                            { term: t('vehicles.field.chassisNumber'), value: v.chassisNumber },
                            { term: t('vehicles.field.engineNumber'), value: v.engineNumber },
                            { term: t('vehicles.field.federalId'), value: v.federalVehicleId },
                            { term: t('vehicles.field.use'), value: t(`vehicles.use.${v.use}`) },
                            { term: t('vehicles.field.seats'), value: v.seats },
                            { term: t('vehicles.field.loadCapacity'), value: kg(v.loadCapacityKg) },
                            { term: t('vehicles.field.axles'), value: v.axles },
                            { term: t('vehicles.field.grossWeight'), value: kg(v.grossWeightKg) },
                            { term: t('vehicles.field.netWeight'), value: kg(v.netWeightKg) },
                            { term: t('vehicles.field.engineCc'), value: v.engineCc },
                            { term: t('vehicles.field.engineHp'), value: v.engineHp },
                            { term: t('vehicles.field.cylinders'), value: v.cylinders },
                            {
                                term: t('vehicles.field.dimensions'),
                                value:
                                    v.lengthMm && v.widthMm && v.heightMm
                                        ? `${v.lengthMm} × ${v.widthMm} × ${v.heightMm}`
                                        : null
                            },
                            {
                                term: t('vehicles.field.tyres'),
                                value: [v.tyres, v.tyreSize].filter((x) => x !== null).join(' × ') || null
                            },
                            { term: t('vehicles.field.madeIn'), value: v.madeIn },
                            { term: t('vehicles.field.colour'), value: v.colour },
                            { term: t('vehicles.field.fuel'), value: v.fuel && t(`vehicles.fuel.${v.fuel}`) },
                            { term: t('vehicles.field.firstRegisteredOn'), value: day(v.firstRegisteredOn) },
                            { term: t('vehicles.field.handlingUnit'), value: unit(v.handlingUnit.name) }
                        ]}
                    />
                }
                tabs={[
                    {
                        value: 'owners',
                        label: t('vehicles.record.owners'),
                        content: <Owners vehicle={v} day={day} />
                    },
                    {
                        value: 'plates',
                        label: t('vehicles.record.plates'),
                        content: <Plates vehicle={v} day={day} />
                    },
                    {
                        value: 'libres',
                        label: t('vehicles.record.libres'),
                        content: <Libres vehicle={v} day={day} unit={unit} />
                    }
                ]}
                defaultTab="owners"
            />
        </div>
    );
}

type Day = (value: string | null) => string;

/** The ownership timeline, newest first: who held the vehicle from when to when, and how they came to. */
function Owners({ vehicle, day }: { vehicle: Vehicle; day: Day }) {
    const { t, text } = useText();
    const periods = [...vehicle.ownerships].sort((a, b) => b.since.localeCompare(a.since));
    if (periods.length === 0) return <EmptyState title={t('vehicles.record.noOwners')} />;
    return (
        <ol className="border-border flex flex-col gap-4 border-s ps-4" data-ownerships>
            {periods.map((p) => (
                <li key={p.id} className="relative" data-ownership={p.id} data-open={p.until === null}>
                    <span
                        aria-hidden="true"
                        className={`absolute -start-[1.32rem] top-1.5 size-2.5 rounded-full ${p.until === null ? 'bg-primary' : 'bg-muted-foreground'}`}
                    />
                    <div className="text-muted-foreground text-sm">
                        {p.until === null
                            ? t('vehicles.record.since', { from: day(p.since) })
                            : t('vehicles.record.fromTo', { from: day(p.since), to: day(p.until) })}{' '}
                        · {t(`vehicles.acquiredBy.${p.acquiredBy}`)}
                    </div>
                    <div className="font-medium">
                        {p.holders.map((h, i) => (
                            <span key={h.id}>
                                {i > 0 && ', '}
                                <HolderLink holder={h} text={text} />
                            </span>
                        ))}
                    </div>
                    {p.note && <div className="text-muted-foreground text-sm">{p.note}</div>}
                </li>
            ))}
        </ol>
    );
}

/** The plates the vehicle has carried, the current one first. */
function Plates({ vehicle, day }: { vehicle: Vehicle; day: Day }) {
    const { t } = useText();
    const plates = [...vehicle.plates].sort((a, b) => b.since.localeCompare(a.since));
    if (plates.length === 0) return <EmptyState title={t('vehicles.record.noPlates')} />;
    return (
        <Table data-plates>
            <TableHeader>
                <TableRow>
                    <TableHead>{t('vehicles.field.plate')}</TableHead>
                    <TableHead>{t('vehicles.record.plateFormat')}</TableHead>
                    <TableHead>{t('vehicles.record.carried')}</TableHead>
                    <TableHead>{t('vehicles.record.endedReason')}</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {plates.map((p) => (
                    <TableRow key={p.id} data-plate={p.key}>
                        <TableCell className="font-medium">{p.text}</TableCell>
                        <TableCell>{t(`vehicles.plateFormat.${p.format}`)}</TableCell>
                        <TableCell>
                            {p.until === null
                                ? t('vehicles.record.since', { from: day(p.since) })
                                : t('vehicles.record.fromTo', { from: day(p.since), to: day(p.until) })}
                        </TableCell>
                        <TableCell>{p.endedReason ? t(`vehicles.endedReason.${p.endedReason}`) : '—'}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

/** The libres issued for the vehicle, the one in force first. */
function Libres({
    vehicle,
    day,
    unit
}: {
    vehicle: Vehicle;
    day: Day;
    unit: (name: Record<string, string>) => string;
}) {
    const { t } = useText();
    const libres = [...vehicle.libres].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
    if (libres.length === 0) return <EmptyState title={t('vehicles.record.noLibres')} />;
    return (
        <Table data-libres>
            <TableHeader>
                <TableRow>
                    <TableHead>{t('vehicles.record.libreNumber')}</TableHead>
                    <TableHead>{t('vehicles.record.issuedOn')}</TableHead>
                    <TableHead>{t('vehicles.record.issuedBy')}</TableHead>
                    <TableHead>{t('vehicles.field.status')}</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {libres.map((l) => (
                    <TableRow key={l.id} data-libre={l.id}>
                        <TableCell className="font-medium" data-booklet={l.number ?? ''}>
                            {l.number ?? l.nationalReference ?? (
                                <span className="text-muted-foreground font-normal">
                                    {t('vehicles.record.bookletPending')}
                                </span>
                            )}
                        </TableCell>
                        <TableCell>{day(l.issuedOn)}</TableCell>
                        <TableCell>{unit(l.issuingUnit.name)}</TableCell>
                        <TableCell>
                            <StatusBadge value={l.status} label={t(`vehicles.libreStatus.${l.status}`)} />
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
