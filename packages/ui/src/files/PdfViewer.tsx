'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Button } from '../primitives/button';

// The worker is bundled with the app (never fetched from a CDN): offices work offline and the CSP stays strict. It must
// match react-pdf's pdfjs-dist version, which is pinned in package.json.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * A PDF (raw base64) with page navigation and zoom. The text layer makes the text selectable and findable with the
 * browser's own search; printing and saving go through the file viewer's download.
 */
export default function PdfViewer({ base64, labels }: { base64: string; labels?: Partial<PdfViewerLabels> }) {
    const t = { ...DEFAULT_LABELS, ...labels };
    const file = React.useMemo(() => ({ data: base64ToBytes(base64) }), [base64]);
    const [pages, setPages] = React.useState(0);
    const [page, setPage] = React.useState(1);
    const [zoom, setZoom] = React.useState(2); // index into ZOOMS: 100 %

    return (
        <div className="flex h-full flex-col gap-2">
            <div className="flex items-center justify-center gap-2" role="toolbar" aria-label={t.toolbar}>
                <Button
                    variant="outline"
                    size="icon"
                    aria-label={t.previous}
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                >
                    <ChevronLeft />
                </Button>
                <span className="min-w-24 text-center text-sm tabular-nums" aria-live="polite">
                    {pages ? `${page} / ${pages}` : '…'}
                </span>
                <Button
                    variant="outline"
                    size="icon"
                    aria-label={t.next}
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                >
                    <ChevronRight />
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    aria-label={t.zoomOut}
                    disabled={zoom === 0}
                    onClick={() => setZoom((z) => z - 1)}
                >
                    <ZoomOut />
                </Button>
                <span className="w-14 text-center text-sm tabular-nums">{Math.round((ZOOMS[zoom] ?? 1) * 100)}%</span>
                <Button
                    variant="outline"
                    size="icon"
                    aria-label={t.zoomIn}
                    disabled={zoom === ZOOMS.length - 1}
                    onClick={() => setZoom((z) => z + 1)}
                >
                    <ZoomIn />
                </Button>
            </div>
            <div className="flex-1 overflow-auto rounded-md border bg-muted/40 p-2">
                <Document
                    file={file}
                    onLoadSuccess={({ numPages }) => {
                        setPages(numPages);
                        setPage(1);
                    }}
                    loading={<p className="p-4 text-center text-sm text-muted-foreground">{t.loading}</p>}
                    error={<p className="p-4 text-center text-sm text-destructive">{t.error}</p>}
                    className="flex justify-center"
                >
                    <Page pageNumber={page} scale={ZOOMS[zoom] ?? 1} />
                </Document>
            </div>
        </div>
    );
}

export interface PdfViewerLabels {
    toolbar: string;
    previous: string;
    next: string;
    zoomIn: string;
    zoomOut: string;
    loading: string;
    error: string;
}

// The design system carries no catalogue of its own: the app passes translated labels (task 0.13); these are the fallback.
const DEFAULT_LABELS: PdfViewerLabels = {
    toolbar: 'PDF controls',
    previous: 'Previous page',
    next: 'Next page',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    loading: 'Loading PDF…',
    error: 'The PDF could not be shown.'
};

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
