'use client';

/**
 * The replacement's screens (task 1.5, DVC-06): its requests, which are the platform's own requests list narrowed to DVC-06. The
 * libre is replaced in the register only through the case, on the platform's case page.
 */
import Link from 'next/link';
import { Button } from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useText } from '@/lib/preferences';
import { Requests } from '@/screens/workflow/Requests';

export function Replacements() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    return (
        <Requests
            fixed={{ service: 'DVC-06' }}
            title={t('competency.replacements.title')}
            intro={t('competency.replacements.intro')}
            toolbar={
                mayFile && (
                    <div data-replacements>
                        <Button asChild>
                            <Link href="/competency/replacements/new">{t('competency.replacements.fileNew')}</Link>
                        </Button>
                    </div>
                )
            }
        />
    );
}
