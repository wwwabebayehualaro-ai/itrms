import { Suspense } from 'react';

import { PlateStockOverview } from '@/screens/registry/PlateStockOverview';

export default function PlateStockOverviewPage() {
    return (
        <Suspense>
            <PlateStockOverview />
        </Suspense>
    );
}
