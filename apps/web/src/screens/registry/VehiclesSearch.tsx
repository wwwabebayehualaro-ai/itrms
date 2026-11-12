'use client';

/**
 * The vehicle register (task 1.1b): one search box for a plate (current or old, in Latin or Ethiopic letters), a chassis
 * number (all of it or its last characters), an engine number or a federal vehicle id. A vehicle of any office of the region
 * is found; the search is in the address, so a view can be shared. A vehicle not found that has a paper file is back-captured
 * first (ADR-0054, task 1.13): where the office offers that, the empty result says so and opens the back-capture.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
    Alert,
    AlertDescription,
    Button,
    EmptyState,
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
    TableRow
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { useAuthStore } from '@/lib/auth/authStore';
import { useText } from '@/lib/preferences';
import { useVehicleSearch, type VehicleSummary } from '@/lib/vehicles';

import { holderName, STATUS_TONE } from './vehicle-parts';

export function VehiclesSearch() {
    const { t, text } = useText();
    const router = useRouter();
    const params = useSearchParams();
    const q = params.get('q') ?? '';
    const [typed, setTyped] = useState(q);
    const found = useVehicleSearch(q);
    const mayFile = useCan('case:create');
    const offersBackCapture = useAuthStore((s) => s.workspace?.activeUnit.services.includes('MIG-01') ?? false);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        router.replace(`/registry/vehicles?q=${encodeURIComponent(typed.trim())}`);
    };
    const rows: VehicleSummary[] | undefined = found.data;
    const searched = q.trim().length >= 2;

    return (
        <div className="flex flex-col gap-6" data-screen="vehicles-search">
            <PageHeader title={t('vehicles.search.title')} description={t('vehicles.search.intro')} />
            <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end" role="search">
                <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor="vehicle-search" className="sr-only">
                        {t('vehicles.search.label')}
                    </Label>
                    <Input
                        id="vehicle-search"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={t('vehicles.search.placeholder')}
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={40}
                    />
                </div>
                <Button type="submit">{t('vehicles.search.submit')}</Button>
            </form>

            {found.isFetching && <Skeleton className="h-24 w-full" />}
            {!found.isFetching && found.error && (
                <Alert variant="destructive">
                    <AlertDescription>{getApiErrorMessage(found.error, t('vehicles.search.failed'))}</AlertDescription>
                </Alert>
            )}
            {!found.isFetching && searched && rows?.length === 0 && (
                <EmptyState
                    title={t('vehicles.search.none')}
                    description={
                        mayFile && offersBackCapture
                            ? t('vehicles.search.notOnRegister')
                            : t('vehicles.search.noneHint')
                    }
                    action={
                        mayFile && offersBackCapture ? (
                            <Button asChild variant="outline" data-back-capture>
                                <Link href="/competency/back-captures/new">{t('vehicles.search.backCapture')}</Link>
                            </Button>
                        ) : undefined
                    }
                />
            )}
            {!found.isFetching && rows && rows.length > 0 && (
                <Table data-results>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('vehicles.field.plate')}</TableHead>
                            <TableHead>{t('vehicles.field.makeModel')}</TableHead>
                            <TableHead>{t('vehicles.field.chassisNumber')}</TableHead>
                            <TableHead>{t('vehicles.field.owner')}</TableHead>
                            <TableHead>{t('vehicles.field.handlingUnit')}</TableHead>
                            <TableHead>{t('vehicles.field.status')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((v) => (
                            <TableRow key={v.id} data-vehicle={v.id}>
                                <TableCell>
                                    <Link href={`/registry/vehicles/${v.id}`} className="font-medium hover:underline">
                                        {v.currentPlate?.text ?? t('vehicles.record.noPlate')}
                                    </Link>
                                    {v.migration && (
                                        <span className="ms-2" data-migrated={v.migration.source}>
                                            <StatusBadge
                                                value={v.migration.source}
                                                tone="info"
                                                label={t('vehicles.field.migrated')}
                                            />
                                        </span>
                                    )}
                                    {v.matched && v.matched !== 'plate' && (
                                        <span className="text-muted-foreground ms-2 text-xs" data-matched={v.matched}>
                                            {t(`vehicles.match.${v.matched}`)}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {v.make} {v.model} · {v.modelYear}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{v.chassisNumber}</TableCell>
                                <TableCell>{v.owners.map((o) => holderName(o, text)).join(', ') || '—'}</TableCell>
                                <TableCell>{text({ am: '', en: '', ...v.handlingUnit.name })}</TableCell>
                                <TableCell>
                                    <StatusBadge
                                        value={v.status}
                                        tone={STATUS_TONE[v.status]}
                                        label={t(`vehicles.status.${v.status}`)}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
