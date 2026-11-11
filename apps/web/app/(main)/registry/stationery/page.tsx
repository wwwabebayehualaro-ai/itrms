import { Suspense } from 'react';

import { StationeryOverview } from '@/screens/registry/StationeryScreens';

export default function StationeryOverviewPage() {
    return (
        <Suspense>
            <StationeryOverview />
        </Suspense>
    );
}
