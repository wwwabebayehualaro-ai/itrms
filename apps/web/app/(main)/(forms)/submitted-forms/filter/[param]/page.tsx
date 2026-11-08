'use client';

import { useParams } from 'next/navigation';
import { InlineStatus } from '@itrms/ui';
import { useText } from '@/lib/preferences';
import { RequestsList } from '../../RequestsList';

/** The quick filter across every form: the signed-in person's own requests. */
export default function FilterPage() {
    const { t } = useText();
    const param = String(useParams().param ?? '');
    if (param === 'my-submissions')
        return (
            <RequestsList
                key={param}
                title={t('common.label.myRequests')}
                description={t('shell.requests.filter.mineIntro')}
            />
        );
    return <InlineStatus error={t('shell.requests.filter.unknown', { param })} />;
}
