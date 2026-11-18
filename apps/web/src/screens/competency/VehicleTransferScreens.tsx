'use client';

/**
 * The vehicle transfer's screens (task 1.4c, DVC-14, DVC-15, DVC-16 and DVC-17): the requests of the services, which are the platform's own
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
                            <Button asChild variant="outline">
                                <Link href="/competency/vehicle-transfers/cancel/new">
                                    {t('competency.vehicleTransfers.fileCancel')}
                                </Link>
                            </Button>
                            <Button asChild variant="outline">
                                <Link href="/competency/vehicle-transfers/arrival/new">
                                    {t('competency.vehicleTransfers.fileArrival')}
                                </Link>
                            </Button>
                        </div>
                    )
                }
            />
            <Requests fixed={{ service: 'DVC-15' }} title={t('competency.vehicleTransfers.fileIn')} />
            <Requests fixed={{ service: 'DVC-16' }} title={t('competency.vehicleTransfers.fileCancel')} />
            <Requests fixed={{ service: 'DVC-17' }} title={t('competency.vehicleTransfers.fileArrival')} />
        </div>
    );
}
