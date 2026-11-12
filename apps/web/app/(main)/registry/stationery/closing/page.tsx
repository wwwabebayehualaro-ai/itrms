import { Suspense } from 'react';

import { StationeryClosingScreen } from '@/screens/registry/StationeryScreens';

export default function StationeryClosingPage() {
    return (
        <Suspense>
            <StationeryClosingScreen />
        </Suspense>
    );
}
