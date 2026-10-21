// Generated from openapi.json by `pnpm --filter @itrms/api-client generate`. Do not edit by hand.

export interface paths {
    "/api/v1/org-units": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrgController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/org-units/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrgController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["OrgController_rename"];
        trace?: never;
    };
    "/api/v1/org-units/{id}/deactivations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrgController_deactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/org-units/{id}/moves": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrgController_move"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/org-units/{id}/services": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrgController_services"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/org-units/{id}/services/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["OrgController_setService"];
        post?: never;
        delete: operations["OrgController_resetService"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/org-units/{id}/subtree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrgController_subtree"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        CreateUnitDto: {
            category?: string;
            code: string;
            /** @enum {string} */
            kind: "region" | "zone" | "woreda" | "special_woreda" | "town_admin" | "city_admin" | "sub_city" | "kebele";
            levelKey: string;
            name: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
            /** Format: uuid */
            parentId: string;
            /** Format: uuid */
            unitTypeId?: string;
        };
        MoveUnitDto: {
            /** Format: uuid */
            parentId: string;
        };
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
        RenameUnitDto: {
            name: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
        };
        ServiceOverrideDto: {
            enabled: boolean;
            reason: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    OrgController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateUnitDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrgController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrgController_rename: {
        parameters: {
            query?: never;
            header: {
                "if-match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenameUnitDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrgController_deactivate: {
        parameters: {
            query?: never;
            header: {
                "if-match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrgController_move: {
        parameters: {
            query?: never;
            header: {
                "if-match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MoveUnitDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrgController_services: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrgController_setService: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ServiceOverrideDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrgController_resetService: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrgController_subtree: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
