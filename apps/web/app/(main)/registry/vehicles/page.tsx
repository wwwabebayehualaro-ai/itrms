import { Suspense } from 'react';

import { VehiclesSearch } from '@/screens/registry/VehiclesSearch';

export default function VehiclesPage() {
    return (
        <Suspense>
            <VehiclesSearch />
        </Suspense>
    );
}
