'use client';

import dynamic from 'next/dynamic';
import { Spinner } from '../primitives/spinner';

/** The PDF engine needs browser globals and is heavy: load it on demand, client-side only. */
export const FileViewer = dynamic(() => import('./FileViewer'), {
    ssr: false,
    loading: () => <Spinner aria-label="Loading viewer" />
});
