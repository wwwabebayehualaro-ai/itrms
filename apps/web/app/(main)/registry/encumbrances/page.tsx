import { Suspense } from 'react';

import { Encumbrances } from '@/screens/registry/Encumbrances';

export default function EncumbrancesPage() {
    return (
        <Suspense>
            <Encumbrances />
        </Suspense>
    );
}
