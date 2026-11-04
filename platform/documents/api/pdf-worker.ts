// The `worker-documents` process's entry of @itrms/documents, and the only way to Chrome (dependency-cruiser:
// only-the-pdf-worker-reaches-chrome).
export { findChrome, PdfRenderer, type PdfRendererOptions } from './render/chrome';
export { fontFaces } from './render/html';
export { currentSigningKey, qrImage } from './jobs/signing';
export { pdfWorkerHandlers, renderIssuedDocument, type PdfWorkerDeps } from './jobs/render-document';
