import { Suspense } from 'react';

import { PlateBatchReceive } from '@/screens/registry/PlateBatchReceive';

export default function PlateBatchReceivePage() {
    return (
        <Suspense>
            <PlateBatchReceive />
        </Suspense>
    );
}
