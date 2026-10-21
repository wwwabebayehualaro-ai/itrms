// Generated from openapi.json by `pnpm --filter @itrms/api-client generate`. Do not edit by hand.

export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Problem */
        Problem: {
            /** @description Stable snake_case code (api-guidelines.md §4) */
            code: string;
            detail?: string;
            /** @description One entry per refused value */
            errors?: {
                code: string;
                message: string;
                path: string;
            }[];
            status: number;
            /** @description The problem in the person's language */
            title: string;
            /** @description The request id, to quote to support */
            traceId?: string;
            /** @description urn:itrms:problem:<code> */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
