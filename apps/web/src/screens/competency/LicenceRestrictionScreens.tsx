'use client';

/**
 * The suspension and cancellation record of a driver licence (DVC-21, ADR-0064 §6, task 1.6c): the platform's own requests list
 * narrowed to DVC-21. A record is filed from the deciding authority's decision and approved by another person; the case page is the
 * platform's, and the register shows the restriction beside its licence.
 */
import Link from 'next/link';
import { Button } from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useText } from '@/lib/preferences';
import { Requests } from '@/screens/workflow/Requests';

export function LicenceRestrictions() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    return (
        <Requests
            fixed={{ service: 'DVC-21' }}
            title={t('competency.licenceRestrictions.title')}
            intro={t('competency.licenceRestrictions.intro')}
            toolbar={
                mayFile ? (
                    <div data-licence-restrictions>
                        <Button asChild>
                            <Link href="/competency/licence-restrictions/new">
                                {t('competency.licenceRestrictions.fileNew')}
                            </Link>
                        </Button>
                    </div>
                ) : undefined
            }
        />
    );
}
