// Public entry of @itrms/documents for API processes (code-structure.md §4): the module, issuing, and the tables. Never
// the renderer: only the `worker-documents` process loads Chrome (./api/pdf-worker).
export { DocumentsModule } from './documents.module';
export { DOCUMENT_CASE_ACCESS, type DocumentCaseAccess, type DocumentCaseReader } from './case-access';
export { DocumentsService, type DocumentReader } from './documents.service';
export { IssueDocumentEffect } from './issue.effect';
export { addisDay, issueDocument, revokeDocument, supersedeDocument, type IssueInput, type IssuedRow } from './issue';
export * from './documents.table';
