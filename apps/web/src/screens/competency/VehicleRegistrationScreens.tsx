'use client';

/**
 * The new vehicle registration service's screens (task 1.2b): its requests, which are the platform's own requests list narrowed to
 * DVC-01, and the plates the office holds for them. A vehicle is made only by its case's workflow, on the platform's own case page.
 */
import Link from 'next/link';
import { Alert, AlertDescription, Button, Skeleton } from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { useAuthStore } from '@/lib/auth/authStore';
import { useReservedPlates } from '@/lib/plate-stock';
import { useText } from '@/lib/preferences';
import { Requests } from '@/screens/workflow/Requests';

/** The plates this office has set aside for registrations still open: each opens the case that holds it. */
export function ReservedPlates() {
    const { t } = useText();
    const unitId = useAuthStore((s) => s.workspace?.activeUnit.id);
    const reserved = useReservedPlates(unitId);
    return (
        <section className="flex flex-col gap-2" data-reserved-plates>
            <h2 className="text-base font-medium">{t('competency.vehicleRegistrations.reservedPlates')}</h2>
            {reserved.isPending ? (
                <Skeleton className="h-10 w-full" />
            ) : reserved.error ? (
                <Alert variant="destructive">
                    <AlertDescription>
                        {getApiErrorMessage(reserved.error, t('competency.vehicleRegistrations.reservedError'))}
                    </AlertDescription>
                </Alert>
            ) : reserved.data.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-reserved-empty>
                    {t('competency.vehicleRegistrations.reservedEmpty')}
                </p>
            ) : (
                <ul className="flex flex-wrap gap-2">
                    {reserved.data.map((plate) =>
                        plate.caseId ? (
                            <li key={plate.id}>
                                <Button asChild variant="outline" size="sm">
                                    <Link href={`/cases/${plate.caseId}`} data-reserved-plate={plate.key}>
                                        {plate.text}
                                    </Link>
                                </Button>
                            </li>
                        ) : null
                    )}
                </ul>
            )}
        </section>
    );
}

export function VehicleRegistrations() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    const mayReadStock = useCan('plate-stock:read');
    return (
        <Requests
            fixed={{ service: 'DVC-01' }}
            title={t('competency.vehicleRegistrations.title')}
            intro={t('competency.vehicleRegistrations.intro')}
            toolbar={
                <div className="flex flex-col gap-4" data-vehicle-registrations>
                    {mayFile && (
                        <div>
                            <Button asChild>
                                <Link href="/competency/vehicle-registrations/new">
                                    {t('competency.vehicleRegistrations.fileNew')}
                                </Link>
                            </Button>
                        </div>
                    )}
                    {mayReadStock && <ReservedPlates />}
                </div>
            }
        />
    );
}
