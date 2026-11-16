'use client';

/**
 * The ownership transfer's screens (task 1.4b, DVC-13): its requests, which are the platform's own requests list narrowed to DVC-13.
 * The owners change in the register only through the case, on the platform's case page.
 */
import Link from 'next/link';
import { Button } from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useText } from '@/lib/preferences';
import { Requests } from '@/screens/workflow/Requests';

export function OwnershipTransfers() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    return (
        <Requests
            fixed={{ service: 'DVC-13' }}
            title={t('competency.ownershipTransfers.title')}
            intro={t('competency.ownershipTransfers.intro')}
            toolbar={
                mayFile && (
                    <div data-ownership-transfers>
                        <Button asChild>
                            <Link href="/competency/ownership-transfers/new">
                                {t('competency.ownershipTransfers.fileNew')}
                            </Link>
                        </Button>
                    </div>
                )
            }
        />
    );
}
