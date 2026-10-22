import { Suspense } from 'react';

import { PersonsSearch } from '@/screens/registry/PersonsSearch';

export default function PersonsPage() {
    return (
        <Suspense>
            <PersonsSearch />
        </Suspense>
    );
}
