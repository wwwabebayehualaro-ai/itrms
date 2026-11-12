import { Suspense } from 'react';

import { StationeryReceive } from '@/screens/registry/StationeryScreens';

export default function StationeryReceivePage() {
    return (
        <Suspense>
            <StationeryReceive />
        </Suspense>
    );
}
