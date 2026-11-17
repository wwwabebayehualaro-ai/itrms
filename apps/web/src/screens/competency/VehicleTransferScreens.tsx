'use client';

/**
 * The vehicle transfer's screens (task 1.4c, DVC-14 and DVC-15): the requests of both services, which are the platform's own
 * requests list narrowed to them. The vehicle moves to the other office only through the cases, on the platform's case page.
 */
import Link from 'next/link';
import { Button } from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useText } from '@/lib/preferences';
import { Requests } from '@/screens/workflow/Requests';

export function VehicleTransfers() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    return (
        <div className="space-y-8">
            <Requests
                fixed={{ service: 'DVC-14' }}
                title={t('competency.vehicleTransfers.title')}
                intro={t('competency.vehicleTransfers.intro')}
                toolbar={
                    mayFile && (
                        <div data-vehicle-transfers className="flex flex-wrap gap-2">
                            <Button asChild>
                                <Link href="/competency/vehicle-transfers/out/new">
                                    {t('competency.vehicleTransfers.fileOut')}
                                </Link>
                            </Button>
                            <Button asChild variant="outline">
                                <Link href="/competency/vehicle-transfers/in/new">
                                    {t('competency.vehicleTransfers.fileIn')}
                                </Link>
                            </Button>
                        </div>
                    )
                }
            />
            <Requests fixed={{ service: 'DVC-15' }} title={t('competency.vehicleTransfers.fileIn')} />
        </div>
    );
}
