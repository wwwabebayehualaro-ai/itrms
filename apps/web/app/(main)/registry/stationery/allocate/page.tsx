import { Suspense } from 'react';

import { StationeryAllocate } from '@/screens/registry/StationeryScreens';

export default function StationeryAllocatePage() {
    return (
        <Suspense>
            <StationeryAllocate />
        </Suspense>
    );
}
