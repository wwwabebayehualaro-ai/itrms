'use client';

import { useParams } from 'next/navigation';
import { InlineStatus } from '@itrms/ui';
import { RequestsList } from '../../RequestsList';

/** The quick filter across every form: the signed-in person's own requests. */
export default function FilterPage() {
    const param = String(useParams().param ?? '');
    if (param === 'my-submissions')
        return (
            <RequestsList key={param} title="My requests" description="The requests you submitted, on every form." />
        );
    return <InlineStatus error={`Unknown filter "${param}"`} />;
}
