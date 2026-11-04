// Worker entry of @itrms/documents: registers its jobs/ and handlers/ (code-structure.md §5.2). Only the worker
// processes load it, so the HTTP process never reaches the system pool (dependency-cruiser:
// http-entries-never-reach-system-pool). The renderer is not here: see ./pdf-worker.
export { documentsHandlers, issueReceiptDocument, type ReceiptSource } from './handlers/receipts';
