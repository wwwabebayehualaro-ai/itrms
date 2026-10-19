'use client';

import { useParams } from 'next/navigation';
import { RequestsList } from '../../RequestsList';

export default function StatusPage() {
    const status = String(useParams().status ?? '');
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return (
        <RequestsList
            key={status}
            title={`${label} requests`}
            description={`Requests of every form with the status ${status}.`}
            filter={{ status }}
        />
    );
}
