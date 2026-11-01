/**
 * What a fee is worked out from at the counter (a port, task 0.22a): the service as the person's unit offers it today,
 * and the request's answers settled as filing would store them. The services slice provides it (it resolves the
 * configuration); without it (the fees slice alone, in its own tests) there is no preview.
 */
import type { DbContext, Tx } from '@itrms/kernel/db';

export interface FeeRequest {
    serviceVersionId: string;
    /** the fee rule version the service charges by; null: it charges nothing */
    feeRuleVersionId: string | null;
    /** the service version's mapping of the rule's inputs to the form's keys */
    inputMap: Record<string, string>;
    /** the answers as filing would store them (a client's value for a computed field or the Fee field is no answer) */
    answers: Record<string, unknown>;
}

export interface FeeRequestSource {
    feeRequest(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        serviceCode: string,
        answers: Record<string, unknown>,
        language: string
    ): Promise<FeeRequest>;
}

export const FEE_REQUEST_SOURCE = Symbol('fees.request-source');
