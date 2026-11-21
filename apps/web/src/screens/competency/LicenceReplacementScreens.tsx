'use client';

/**
 * The replacement of a driver licence's card (DVC-19, Art. 18, task 1.6e): the platform's own requests list narrowed to DVC-19. The
 * licence keeps its number; its old card's QR says superseded once the new card is issued. The case page is the platform's.
 */
import Link from 'next/link';
import { Button } from '@itrms/ui';

import { useCan } from '@/lib/auth/authHooks';
import { useText } from '@/lib/preferences';
import { Requests } from '@/screens/workflow/Requests';

export function LicenceReplacements() {
    const { t } = useText();
    const mayFile = useCan('case:create');
    return (
        <Requests
            fixed={{ service: 'DVC-19' }}
            title={t('competency.licenceReplacements.title')}
            intro={t('competency.licenceReplacements.intro')}
            toolbar={
                mayFile ? (
                    <div data-licence-replacements>
                        <Button asChild>
                            <Link href="/competency/licence-replacements/new">
                                {t('competency.licenceReplacements.fileNew')}
                            </Link>
                        </Button>
                    </div>
                ) : undefined
            }
        />
    );
}
