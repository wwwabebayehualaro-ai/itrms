'use client';

/**
 * The back-capture of paper vehicle files (ADR-0054, task 1.13): the platform's own requests list narrowed to MIG-01. A clerk
 * captures the paper file's facts and its scan; a second person checks them against the paper and verifies, and only then does the
 * vehicle join the register, marked as migrated. The case page is the platform's.
 */
import Link from 'next/link';
import { Button } from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useText } from '@/lib/preferences';
import { Requests } from '@/screens/workflow/Requests';

export function BackCaptures() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    return (
        <Requests
            fixed={{ service: 'MIG-01' }}
            title={t('competency.backCaptures.title')}
            intro={t('competency.backCaptures.intro')}
            toolbar={
                mayFile ? (
                    <div data-back-captures>
                        <Button asChild>
                            <Link href="/competency/back-captures/new">{t('competency.backCaptures.fileNew')}</Link>
                        </Button>
                    </div>
                ) : undefined
            }
        />
    );
}
