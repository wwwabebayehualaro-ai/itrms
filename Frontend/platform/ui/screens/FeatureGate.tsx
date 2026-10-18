'use client';

import * as React from 'react';
import { useFeatureFlag } from '@platform/lib/modules';

/**
 * Render `children` only while a feature flag is on for the tenant (`fallback` otherwise, nothing while loading).
 * The server enforces module flags on the API as well; this only keeps the UI consistent with it.
 */
export function FeatureGate({ flag, children, fallback = null }: { flag: string; children: React.ReactNode; fallback?: React.ReactNode }) {
    const on = useFeatureFlag(flag);
    if (on === undefined) return null;
    return <>{on ? children : fallback}</>;
}
