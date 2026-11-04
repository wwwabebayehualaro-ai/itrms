// Public entry of @itrms/documents for API processes (code-structure.md §4): the module, issuing, and the tables. Never
// the renderer: only the `worker-documents` process loads Chrome (./api/pdf-worker).
export { DocumentsModule } from './documents.module';
export { DocumentsService } from './documents.service';
export { IssueDocumentEffect } from './issue.effect';
export { addisDay, issueDocument, revokeDocument, supersedeDocument, type IssueInput, type IssuedRow } from './issue';
export * from './documents.table';
