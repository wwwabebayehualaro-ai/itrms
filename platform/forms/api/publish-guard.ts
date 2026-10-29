/**
 * What a form's publication must not break above the forms slice (a port, task 0.21d): the services whose effects read
 * the form check a candidate version against their input contracts (blocking problems), say what the publication touches
 * (the services, their open cases, the bound effects), and name the fields the builder shows locked. The services slice
 * provides it; without it (the forms slice alone, in its own tests) nothing is added.
 */
import type { Tx } from '@itrms/kernel/db';

import type { CheckProblem, FormLock, ImpactService } from '../contracts';

export interface GuardResult {
    /** blocking problems (`contract`), each with its path and message in the reader's language */
    problems: CheckProblem[];
    services: ImpactService[];
}

export interface FormPublishGuard {
    check(tx: Tx, formId: string, document: unknown, language: string): Promise<GuardResult>;
    locks(tx: Tx, formId: string): Promise<FormLock[]>;
}

export const FORM_PUBLISH_GUARD = Symbol('forms.publish-guard');
