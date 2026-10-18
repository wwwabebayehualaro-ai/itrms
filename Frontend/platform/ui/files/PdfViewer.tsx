'use client';

import { Viewer, Worker } from '@react-pdf-viewer/core';
import '@react-pdf-viewer/core/lib/styles/index.css';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

/** A PDF (raw base64) with page navigation, zoom, search and print. The worker matches the pinned pdfjs-dist 3.11.174. */
export default function PdfViewer({ base64 }: { base64: string }) {
    const layout = defaultLayoutPlugin();
    return (
        <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
            <Viewer fileUrl={`data:application/pdf;base64,${base64}`} plugins={[layout]} />
        </Worker>
    );
}
