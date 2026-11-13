'use client';

/**
 * The bolo's screens (task 1.3a, DVC-02): its requests, which are the platform's own requests list narrowed to DVC-02. The
 * inspection, the sticker and a temporary bolo are steps of the case, on the platform's case page.
 */
import Link from 'next/link';
import { Button } from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useText } from '@/lib/preferences';
import { Requests } from '@/screens/workflow/Requests';

export function Bolos() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    return (
        <Requests
            fixed={{ service: 'DVC-02' }}
            title={t('competency.bolos.title')}
            intro={t('competency.bolos.intro')}
            toolbar={
                mayFile ? (
                    <div data-bolos>
                        <Button asChild>
                            <Link href="/competency/bolos/new">{t('competency.bolos.fileNew')}</Link>
                        </Button>
                    </div>
                ) : undefined
            }
        />
    );
}
