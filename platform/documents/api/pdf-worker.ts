// The `worker-documents` process's entry of @itrms/documents, and the only way to Chrome (dependency-cruiser:
// only-the-pdf-worker-reaches-chrome).
export { findChrome, PdfRenderer, type PdfRendererOptions } from './render/chrome';
export { pdfWorkerHandlers, renderIssuedDocument, type PdfWorkerDeps } from './jobs/render-document';
