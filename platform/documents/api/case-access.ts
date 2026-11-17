/**
 * Who works on a case (a port, ADR-0055): the documents slice sits below the workflow, so the workflow provides this, as it
 * provides the fees' FEE_CASE_PORT. A holder of `issued-document:read-case` only reads the documents of a case it works on.
 * Without a provider (the documents slice alone, in its own tests) nobody works on any case: the narrow reading fails closed.
 */
import type { Tx } from '@itrms/kernel/db';

export interface DocumentCaseReader {
    userId: string;
    unitId: string;
    roles: readonly string[];
}

export interface DocumentCaseAccess {
    /** Whether the person took or acted on a step of the case, or an open step of it waits for their role in their unit. */
    worksOn(tx: Tx, caseId: string, who: DocumentCaseReader): Promise<boolean>;
}

export const DOCUMENT_CASE_ACCESS = Symbol('documents.case-access');
