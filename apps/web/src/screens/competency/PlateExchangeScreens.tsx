'use client';

/**
 * The plate exchange's screens (task 1.2c, DVC-12): its requests, which are the platform's own requests list narrowed to DVC-12,
 * and the plates the office holds for open requests. The plate goes on the vehicle only through its case, on the platform's case
 * page.
 */
import Link from 'next/link';
import { Button } from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useText } from '@/lib/preferences';
import { ReservedPlates } from '@/screens/competency/VehicleRegistrationScreens';
import { Requests } from '@/screens/workflow/Requests';

export function PlateExchanges() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    const mayReadStock = useCan('plate-stock:read');
    return (
        <Requests
            fixed={{ service: 'DVC-12' }}
            title={t('competency.plateExchanges.title')}
            intro={t('competency.plateExchanges.intro')}
            toolbar={
                <div className="flex flex-col gap-4" data-plate-exchanges>
                    {mayFile && (
                        <div>
                            <Button asChild>
                                <Link href="/competency/plate-exchanges/new">
                                    {t('competency.plateExchanges.fileNew')}
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
