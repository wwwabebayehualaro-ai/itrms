import { Suspense } from 'react';

import { PlateAllocate } from '@/screens/registry/PlateAllocate';

export default function PlateAllocatePage() {
    return (
        <Suspense>
            <PlateAllocate />
        </Suspense>
    );
}
