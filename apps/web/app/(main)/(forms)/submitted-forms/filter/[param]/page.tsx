'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { InlineStatus } from '@itrms/ui';
import { RequestsList } from '../../RequestsList';

const RECENT_DAYS = 7;

/** Quick filters across every form: the signed-in person's requests, or the last week's. */
export default function FilterPage() {
    const param = String(useParams().param ?? '');
    // fixed for the visit (to the start of the day), so the query key stays stable
    const [since] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - RECENT_DAYS);
        return d.toISOString();
    });
    if (param === 'my-submissions')
        return (
            <RequestsList
                key={param}
                title="My requests"
                description="The requests you submitted, on every form."
                filter={{ mine: true }}
            />
        );
    if (param === 'recent')
        return (
            <RequestsList
                key={param}
                title="Recent requests"
                description={`Requests of every form submitted in the last ${RECENT_DAYS} days.`}
                filter={{ createdAfter: since }}
            />
        );
    return <InlineStatus error={`Unknown filter "${param}"`} />;
}
