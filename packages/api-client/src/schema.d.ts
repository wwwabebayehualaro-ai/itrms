// Generated from openapi.json by `pnpm --filter @itrms/api-client generate`. Do not edit by hand.

export interface paths {
    "/api/v1/admin/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["JobsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/jobs/{id}/retries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["JobsController_retry"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CasesController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/fee": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FeesController_forCase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/payment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PaymentsController_forCase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CasesController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{id}/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CasesController_audit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{id}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_comment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{id}/people": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CasesController_people"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{id}/tasks/{taskId}/claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_claim"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{id}/tasks/{taskId}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_release"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{id}/transitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_transition"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competency/grades": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CompetencyController_grades"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competency/licences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CompetencyController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competency/licences/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CompetencyController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competency/print-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CompetencyController_batches"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competency/print-batches/{id}/printing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CompetencyController_printed"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competency/print-batches/{id}/sending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CompetencyController_send"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competency/training-enrolments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CompetencyController_enrolments"];
        put?: never;
        post: operations["CompetencyController_enrol"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competency/training-enrolments/{id}/completion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CompetencyController_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/document-header": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_header"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/external-issuers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ExternalPaymentsController_issuers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/external-payment-refs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ExternalPaymentsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/external-payment-refs/{id}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ExternalPaymentsController_decide"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/external-payment-refs/{id}/revocation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ExternalPaymentsController_revoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/external-statements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ExternalPaymentsController_statements"];
        put?: never;
        post: operations["ExternalPaymentsController_importStatement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/external-statements/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ExternalPaymentsController_statement"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/external-statements/{id}/lines": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ExternalPaymentsController_lines"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fee-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FeesController_list"];
        put?: never;
        post: operations["FeesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fee-rules/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FeesController_check"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fee-rules/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FeesController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fee-rules/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FeesController_versions"];
        put?: never;
        post: operations["FeesController_addVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fee-rules/{id}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FeesController_version"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fee-rules/{id}/versions/{versionId}/approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FeesController_decide"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fees/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FeesController_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FilesController_begin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FilesController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_download"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/form-drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DraftsController_list"];
        put?: never;
        post: operations["DraftsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/form-drafts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DraftsController_get"];
        put?: never;
        post?: never;
        delete: operations["DraftsController_remove"];
        options?: never;
        head?: never;
        patch: operations["DraftsController_update"];
        trace?: never;
    };
    "/api/v1/form-publications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PublicationsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/form-publications/count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PublicationsController_count"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/form-publications/{id}/approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PublicationsController_approve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/form-publications/{id}/rejection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PublicationsController_reject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/form-publications/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PublicationsController_review"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/form-publications/{id}/withdrawal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PublicationsController_withdraw"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_list"];
        put?: never;
        post: operations["FormsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["FormsController_update"];
        trace?: never;
    };
    "/api/v1/forms/{id}/locks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_locks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}/overlays/{unitId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_overlay"];
        put: operations["FormsController_saveOverlay"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}/overlays/{unitId}/publications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FormsController_requestOverlayPublication"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}/publications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FormsController_requestPublication"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}/publish-check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_publishCheck"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_versions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}/versions/published": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_published"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_version"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}/view": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_view"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/forms/{id}/views": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FormsController_views"];
        put?: never;
        post: operations["FormsController_createView"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/issued-documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/issued-documents/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_download"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NotificationsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/notifications/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NotificationsController_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["IamController_preferences"];
        trace?: never;
    };
    "/api/v1/me/settings/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SettingsController_setMine"];
        post?: never;
        delete: operations["SettingsController_resetMine"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["InboxController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/tasks/count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["InboxController_count"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/workspace": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["IamController_workspace"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
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
    "/api/v1/org-units/{id}/role-assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["IamController_assignments"];
        put?: never;
        post?: never;
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
    "/api/v1/org-units/{id}/services/{code}/configuration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ServicesController_configuration"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/org-units/{id}/services/{code}/override": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ServicesController_setOverride"];
        post?: never;
        delete: operations["ServicesController_resetOverride"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/org-units/{id}/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SettingsController_forUnit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/org-units/{id}/settings/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SettingsController_setForUnit"];
        post?: never;
        delete: operations["SettingsController_resetForUnit"];
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
    "/api/v1/organisations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganisationsController_search"];
        put?: never;
        post: operations["OrganisationsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organisations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganisationsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["OrganisationsController_update"];
        trace?: never;
    };
    "/api/v1/organisations/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrganisationsController_addMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organisations/{id}/members/{memberId}/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrganisationsController_endMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/payment-orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PaymentsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/payment-orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PaymentsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/payment-orders/{id}/external-refs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ExternalPaymentsController_enter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/payment-orders/{id}/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PaymentsController_record"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/person-merges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MergesController_list"];
        put?: never;
        post: operations["MergesController_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/person-merges/{id}/approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MergesController_approve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/person-merges/{id}/rejection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MergesController_reject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/persons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PersonsController_search"];
        put?: never;
        post: operations["PersonsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/persons/duplicates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PersonsController_duplicates"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/persons/lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PersonsController_lookup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/persons/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PersonsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["PersonsController_update"];
        trace?: never;
    };
    "/api/v1/persons/{id}/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PersonsController_reveal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/allocations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PlateStockController_allocate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlateStockController_batches"];
        put?: never;
        post: operations["PlateStockController_receive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/batches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlateStockController_batch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/movements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlateStockController_movements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/movements/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlateStockController_movement"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/movements/{id}/acceptance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PlateStockController_accept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/plates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlateStockController_plates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/recalls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PlateStockController_recall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlateStockController_summary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plate-stock/write-offs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PlateStockController_writeOff"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/verification-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VerificationController_keys"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/verifications/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VerificationController_verify"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/receipt-reversals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PaymentsController_reversals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/receipt-reversals/{id}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PaymentsController_decide"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/receipts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PaymentsController_receipt"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/receipts/{id}/reversals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PaymentsController_requestReversal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registry-lookups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RegistryLookupsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registry-lookups/{provider}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RegistryLookupsController_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registry-lookups/{provider}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RegistryLookupsController_items"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/role-assignments/{id}/revocations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IamController_revoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/role-grant-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["IamController_grantRequests"];
        put?: never;
        post: operations["IamController_requestGrant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/role-grant-requests/{id}/confirmations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IamController_confirmGrant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/role-grant-requests/{id}/rejections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IamController_rejectGrant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/saved-views/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["SavedViewsController_remove"];
        options?: never;
        head?: never;
        patch: operations["SavedViewsController_update"];
        trace?: never;
    };
    "/api/v1/service-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ServicesController_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/services": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ServicesController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/services/{code}/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ServicesController_requestForm"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/services/{code}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ServicesController_versions"];
        put?: never;
        post: operations["ServicesController_publish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/allocations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StationeryController_allocate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StationeryController_batches"];
        put?: never;
        post: operations["StationeryController_receive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/closings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StationeryController_closings"];
        put?: never;
        post: operations["StationeryController_close"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StationeryController_items"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/movements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StationeryController_movements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/movements/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StationeryController_movement"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/movements/{id}/acceptance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StationeryController_accept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/recalls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StationeryController_recall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StationeryController_summary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stationery/write-offs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StationeryController_writeOff"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submission-exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ExportsController_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submission-exports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ExportsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submission-exports/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ExportsController_download"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SubmissionsController_list"];
        put?: never;
        post: operations["SubmissionsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SubmissionsController_export"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/query": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SubmissionsController_query"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SubmissionsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SubmissionsController_history"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SubmissionsController_reveal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/unit-types/{id}/settings/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SettingsController_setForUnitType"];
        post?: never;
        delete: operations["SettingsController_resetForUnitType"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/vehicle-categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VehicleCategoriesController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/vehicles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VehiclesController_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/vehicles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VehiclesController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflow-definitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkflowDefinitionsController_list"];
        put?: never;
        post: operations["WorkflowDefinitionsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflow-definitions/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WorkflowDefinitionsController_check"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflow-definitions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkflowDefinitionsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["WorkflowDefinitionsController_update"];
        trace?: never;
    };
    "/api/v1/workflow-definitions/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkflowDefinitionsController_versions"];
        put?: never;
        post: operations["WorkflowDefinitionsController_addVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workflow-definitions/{id}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkflowDefinitionsController_version"];
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
        AcceptDto: {
            exceptKeys?: string[];
            note?: string;
        };
        AllocateDto: {
            note?: string;
            plates: {
                from: number;
                series: string;
                to: number;
            } | {
                keys: string[];
            };
            /** Format: uuid */
            toUnitId: string;
        };
        CaseAuditOut_Output: {
            items: {
                /** @enum {string} */
                action: "insert" | "update" | "delete" | "event";
                actor: {
                    /** Format: uuid */
                    id: string;
                    name: string;
                } | null;
                /** Format: date-time */
                at: string;
                event: string | null;
                fields: string[];
                table: string | null;
            }[];
            truncated: boolean;
        };
        ClosingDto: {
            /** Format: date */
            closedOn: string;
            counted: {
                from: number;
                series?: string;
                to: number;
            }[];
            /** @enum {string} */
            kind: "libre_booklet" | "licence_blank" | "bolo_sticker" | "receipt_leaf";
            note?: string;
        };
        CommentDto: {
            /** @default [] */
            mentions: string[];
            text: string;
        };
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
        DecisionDto: {
            reason: string;
        };
        DraftCreateDto: {
            answers: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            formId: string;
            /** Format: uuid */
            formVersionId: string;
        };
        DraftUpdateDto: {
            answers: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            formVersionId?: string;
        };
        DuplicateCheckDto: {
            nameAm: {
                father: string;
                given: string;
                grandfather?: string;
            };
            nameEn?: {
                father: string;
                given: string;
                grandfather?: string;
            };
            sensitive?: {
                birthDate?: string | null;
                fin?: string | null;
                phone?: string | null;
            };
        };
        EnrolmentCompleteDto: {
            /** Format: date */
            completedOn: string;
        };
        EnrolmentCreateDto: {
            grade: string;
            /** Format: uuid */
            personId: string;
            /** Format: uuid */
            schoolId: string;
        };
        FeePreviewDto: {
            /** @default {} */
            answers: {
                [key: string]: unknown;
            };
            serviceCode: string;
        };
        FeeRuleCheckDto: {
            document: {
                basis?: string;
                /** @default false */
                demo: boolean;
                inputs: {
                    [key: string]: {
                        fact?: string;
                        /**
                         * @default answer
                         * @enum {string}
                         */
                        from: "answer" | "fact";
                        /** @enum {string} */
                        kind: "text" | "number" | "boolean" | "date" | "ethdate" | "choice" | "multi";
                        /** @default true */
                        required: boolean;
                    };
                };
                lines: ({
                    amount: string;
                    key: string;
                    /** @constant */
                    kind: "fixed";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    when?: string;
                } | {
                    input: string;
                    key: string;
                    /** @constant */
                    kind: "table";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    otherwise?: string;
                    rows: {
                        amount: string;
                        value: string | number | boolean;
                    }[];
                    when?: string;
                } | {
                    amount: string;
                    key: string;
                    /** @constant */
                    kind: "perUnit";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    maxAmount?: string;
                    maxUnits?: number;
                    quantity: string;
                    when?: string;
                } | {
                    basisPoints: number;
                    key: string;
                    /** @constant */
                    kind: "percent";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    maxAmount?: string;
                    maxUnits?: number;
                    of: string[];
                    quantity?: string;
                    when?: string;
                })[];
                /**
                 * @default filing
                 * @enum {string}
                 */
                reassessAsOf: "filing" | "reassessment";
                /** @constant */
                schemaVersion: 1;
            };
        };
        FeeRuleCreateDto: {
            document: {
                basis?: string;
                /** @default false */
                demo: boolean;
                inputs: {
                    [key: string]: {
                        fact?: string;
                        /**
                         * @default answer
                         * @enum {string}
                         */
                        from: "answer" | "fact";
                        /** @enum {string} */
                        kind: "text" | "number" | "boolean" | "date" | "ethdate" | "choice" | "multi";
                        /** @default true */
                        required: boolean;
                    };
                };
                lines: ({
                    amount: string;
                    key: string;
                    /** @constant */
                    kind: "fixed";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    when?: string;
                } | {
                    input: string;
                    key: string;
                    /** @constant */
                    kind: "table";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    otherwise?: string;
                    rows: {
                        amount: string;
                        value: string | number | boolean;
                    }[];
                    when?: string;
                } | {
                    amount: string;
                    key: string;
                    /** @constant */
                    kind: "perUnit";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    maxAmount?: string;
                    maxUnits?: number;
                    quantity: string;
                    when?: string;
                } | {
                    basisPoints: number;
                    key: string;
                    /** @constant */
                    kind: "percent";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    maxAmount?: string;
                    maxUnits?: number;
                    of: string[];
                    quantity?: string;
                    when?: string;
                })[];
                /**
                 * @default filing
                 * @enum {string}
                 */
                reassessAsOf: "filing" | "reassessment";
                /** @constant */
                schemaVersion: 1;
            };
            key: string;
            name: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
        };
        FeeRuleDecisionDto: {
            /** @enum {string} */
            decision: "approved" | "rejected";
            reason?: string;
        };
        FeeRuleVersionDto: {
            document: {
                basis?: string;
                /** @default false */
                demo: boolean;
                inputs: {
                    [key: string]: {
                        fact?: string;
                        /**
                         * @default answer
                         * @enum {string}
                         */
                        from: "answer" | "fact";
                        /** @enum {string} */
                        kind: "text" | "number" | "boolean" | "date" | "ethdate" | "choice" | "multi";
                        /** @default true */
                        required: boolean;
                    };
                };
                lines: ({
                    amount: string;
                    key: string;
                    /** @constant */
                    kind: "fixed";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    when?: string;
                } | {
                    input: string;
                    key: string;
                    /** @constant */
                    kind: "table";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    otherwise?: string;
                    rows: {
                        amount: string;
                        value: string | number | boolean;
                    }[];
                    when?: string;
                } | {
                    amount: string;
                    key: string;
                    /** @constant */
                    kind: "perUnit";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    maxAmount?: string;
                    maxUnits?: number;
                    quantity: string;
                    when?: string;
                } | {
                    basisPoints: number;
                    key: string;
                    /** @constant */
                    kind: "percent";
                    label: {
                        am: string;
                        en: string;
                    } & {
                        [key: string]: string;
                    };
                    maxAmount?: string;
                    maxUnits?: number;
                    of: string[];
                    quantity?: string;
                    when?: string;
                })[];
                /**
                 * @default filing
                 * @enum {string}
                 */
                reassessAsOf: "filing" | "reassessment";
                /** @constant */
                schemaVersion: 1;
            };
        };
        FileConfirmDto: {
            parts?: {
                etag: string;
                partNumber: number;
            }[];
        };
        FileUploadDto: {
            /** @enum {string} */
            contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
            /** @enum {string} */
            documentType?: "id_card" | "fayda_card" | "photo" | "medical_certificate" | "libre_copy" | "bolo_certificate" | "driver_licence_copy" | "training_certificate" | "education_certificate" | "tin_certificate" | "trade_licence" | "contract" | "design_drawing" | "payment_receipt" | "letter" | "other";
            filename: string;
            sha256: string;
            size: number;
        };
        FormCreateDto: {
            category?: string;
            document: {
                [key: string]: unknown;
            } | unknown[];
            key: string;
            /**
             * @default form
             * @enum {string}
             */
            kind: "form" | "block";
            name: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
        };
        FormOverlayPutDto: {
            patch: {
                add?: {
                    after: string;
                    fields: ({
                        behavior?: ({
                            actions?: {
                                [key: string]: unknown[];
                            } | null;
                            enabledConditions?: components["schemas"]["FormOverlayPutDto__schema0"][] | null;
                            validation?: ({
                                errorMessages?: {
                                    [key: string]: unknown;
                                } | null;
                                remote?: ({
                                    dataSourceId: string;
                                    message?: unknown;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                requiredWhen?: ({
                                    expression: string;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                rules?: {
                                    [key: string]: unknown;
                                } | null;
                                supported?: boolean;
                                types?: string[] | null;
                                validWhen?: ({
                                    expression: string;
                                    message?: unknown;
                                } & {
                                    [key: string]: unknown;
                                })[] | null;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                            visibilityConditions?: components["schemas"]["FormOverlayPutDto__schema0"][] | null;
                        } & {
                            [key: string]: unknown;
                        }) | null;
                        category?: string;
                        classification?: ("public" | "internal" | "personal" | "sensitive") | null;
                        data?: ({
                            computed?: ({
                                expression: string;
                                readOnly?: boolean;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                            dataSource?: ({
                                staticData?: unknown;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                            defaultProps?: {
                                [key: string]: unknown;
                            } | null;
                            optionsBinding?: ({
                                dataSourceId: string;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                            rowsBinding?: ({
                                dataSourceId: string;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                        } & {
                            [key: string]: unknown;
                        }) | null;
                        filterable?: boolean | null;
                        id: string | number;
                        label?: (string | {
                            [key: string]: unknown;
                        }) | null;
                        layout?: ({
                            options?: ({
                                isContainer?: boolean;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                        } & {
                            [key: string]: unknown;
                        }) | null;
                        metadata?: ({
                            description?: string;
                        } & {
                            [key: string]: unknown;
                        }) | null;
                        parentId?: string | number | null;
                        props?: {
                            [key: string]: unknown;
                        } | null;
                        removed?: boolean | null;
                        type: string;
                        visibleToRoles?: string[] | null;
                    } & {
                        [key: string]: unknown;
                    })[];
                }[];
                /** @default [] */
                options: {
                    key: string;
                    values: (string | number)[];
                }[];
            };
        };
        FormOverlayPutDto__schema0: {
            clientOnly?: boolean;
            conditions?: components["schemas"]["FormOverlayPutDto__schema0"][];
            /** @default  */
            field: string;
            /** @enum {string} */
            logic?: "and" | "or" | "xor";
            operator: string;
            serverOnly?: boolean;
            value?: unknown;
        } & {
            [key: string]: unknown;
        };
        FormUpdateDto: {
            active?: boolean;
            category?: string | null;
            document?: {
                [key: string]: unknown;
            } | unknown[];
            name?: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
        };
        GrantDto: {
            reason: string;
            roleKey: string;
            /** Format: uuid */
            unitId: string;
            /** Format: uuid */
            userId: string;
            /** Format: date-time */
            validFrom?: string;
            /** Format: date-time */
            validTo?: string;
        };
        LookupItemsOut_Output: {
            items: {
                active: boolean;
                facts: {
                    key: string;
                    label: string;
                    value: string | null;
                }[];
                /** Format: uuid */
                id: string;
                label: string;
            }[];
        };
        LookupProvidersOut_Output: {
            items: {
                facts: {
                    key: string;
                    label: string;
                }[];
                key: string;
                title: string;
            }[];
        };
        MemberAddDto: {
            /** Format: uuid */
            personId: string;
            /** @enum {string} */
            role: "chair" | "secretary" | "treasurer" | "manager" | "owner" | "member";
            /** Format: date */
            since?: string;
        };
        MemberEndDto: {
            /** Format: date */
            until: string;
        };
        MergeDecisionDto: {
            note?: string;
        };
        MergeRequestDto: {
            /** Format: uuid */
            duplicateId: string;
            reason: string;
            /** Format: uuid */
            survivorId: string;
        };
        MoveUnitDto: {
            /** Format: uuid */
            parentId: string;
        };
        OrganisationCreateDto: {
            address?: {
                houseNumber?: string;
                kebele?: string;
                /** Format: uuid */
                unitId: string;
            };
            /** @enum {string} */
            kind: "association" | "training_school" | "contractor" | "consultant" | "garage" | "insurer" | "health_facility" | "government_office" | "other";
            licenceNumber?: string;
            name: {
                am: string;
                en: string;
            };
            tin?: string;
        };
        OrganisationUpdateDto: {
            address?: {
                houseNumber?: string;
                kebele?: string;
                /** Format: uuid */
                unitId: string;
            } | null;
            /** @enum {string} */
            kind?: "association" | "training_school" | "contractor" | "consultant" | "garage" | "insurer" | "health_facility" | "government_office" | "other";
            licenceNumber?: string | null;
            name?: {
                am: string;
                en: string;
            };
            tin?: string | null;
        };
        OverrideDto: {
            reason: string;
            values: {
                [key: string]: unknown;
            };
        };
        PaymentDto: {
            amountSantim: string;
            bankSlip?: {
                bank: string;
                /** Format: date */
                paidOn: string;
                reference: string;
            };
            /** @enum {string} */
            method: "cash" | "bank_slip";
            pad?: {
                serial: string;
                series: string;
            };
            receivedFrom: string;
        };
        PersonCreateDto: {
            acknowledgedDuplicates?: string[];
            address?: {
                houseNumber?: string;
                kebele?: string;
                /** Format: uuid */
                unitId: string;
            };
            birthYear?: number;
            nameAm: {
                father: string;
                given: string;
                grandfather?: string;
            };
            nameEn?: {
                father: string;
                given: string;
                grandfather?: string;
            };
            sensitive?: {
                birthDate?: string | null;
                fin?: string | null;
                phone?: string | null;
            };
            /** @enum {string} */
            sex: "female" | "male";
        };
        PersonLookupDto: {
            fin?: string;
            phone?: string;
        };
        PersonUpdateDto: {
            address?: {
                houseNumber?: string;
                kebele?: string;
                /** Format: uuid */
                unitId: string;
            } | null;
            birthYear?: number | null;
            nameAm?: {
                father: string;
                given: string;
                grandfather?: string;
            };
            nameEn?: {
                father: string;
                given: string;
                grandfather?: string;
            } | null;
            sensitive?: {
                birthDate?: string | null;
                fin?: string | null;
                phone?: string | null;
            };
            /** @enum {string} */
            sex?: "female" | "male";
        };
        PreferencesDto: {
            /** @enum {string} */
            calendar?: "ethiopian" | "gregorian";
            favourites?: string[];
            /** @enum {string} */
            language?: "am" | "en" | "wal-Latn" | "om" | "ti";
            recents?: {
                at: number;
                key: string;
            }[];
        };
        PrintedDto: {
            cards?: {
                cardKey: string;
                /** Format: uuid */
                licenceId: string;
            }[];
            firstCardKey?: string;
            spoiled?: {
                cardKey: string;
                reason: string;
            }[];
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
        PublicationDecisionDto: {
            note?: string;
        };
        PublicationRejectionDto: {
            note: string;
        };
        PublicationRequestDto: {
            note?: string;
        };
        ReadDto: {
            ids: string[];
        };
        RecallDto: {
            /** Format: uuid */
            fromUnitId: string;
            plates: {
                from: number;
                series: string;
                to: number;
            } | {
                keys: string[];
            };
            reason: string;
        };
        ReceiveDto: {
            note?: string;
            plates: {
                from: number;
                series: string;
                to: number;
            } | {
                keys: string[];
            };
            /** Format: date */
            receivedOn: string;
            reference: string;
        };
        RefDecisionDto: {
            /** @enum {string} */
            decision: "verified" | "rejected";
            note?: string;
        };
        RefInputDto: {
            amountSantim: string;
            issuer: string;
            /** Format: date */
            paidOn: string;
            receivedFrom: string;
            reference: string;
        };
        RefRevocationDto: {
            reason: string;
        };
        RenameUnitDto: {
            name: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
        };
        RequestDto: {
            answers?: {
                [key: string]: unknown;
            };
            fee?: {
                /** Format: uuid */
                ruleVersionId: string;
                totalSantim: string;
            };
            serviceCode: string;
        };
        RevealDto: {
            fields: ("birthDate" | "phone" | "fin")[];
            reason: string;
        };
        ReversalDecisionDto: {
            /** @enum {string} */
            decision: "approved" | "rejected";
            note?: string;
        };
        ReversalRequestDto: {
            reason: string;
        };
        SavedViewCreateDto: {
            config: {
                /** @default [] */
                columns: string[];
                filter?: {
                    items: ({
                        field: string;
                        /** @enum {string} */
                        op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                        value?: unknown;
                    } | {
                        items: ({
                            field: string;
                            /** @enum {string} */
                            op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                            value?: unknown;
                        } | {
                            items: ({
                                field: string;
                                /** @enum {string} */
                                op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                value?: unknown;
                            } | {
                                items: ({
                                    field: string;
                                    /** @enum {string} */
                                    op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                    value?: unknown;
                                } | {
                                    items: {
                                        field: string;
                                        /** @enum {string} */
                                        op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                        value?: unknown;
                                    }[];
                                    /**
                                     * @default and
                                     * @enum {string}
                                     */
                                    op: "and" | "or";
                                })[];
                                /**
                                 * @default and
                                 * @enum {string}
                                 */
                                op: "and" | "or";
                            })[];
                            /**
                             * @default and
                             * @enum {string}
                             */
                            op: "and" | "or";
                        })[];
                        /**
                         * @default and
                         * @enum {string}
                         */
                        op: "and" | "or";
                    })[];
                    /**
                     * @default and
                     * @enum {string}
                     */
                    op: "and" | "or";
                };
                /**
                 * @default table
                 * @enum {string}
                 */
                mode: "table" | "cards" | "board" | "calendar" | "pivot" | "dashboard";
                /** @default {} */
                options: {
                    [key: string]: unknown;
                };
                /** @default 20 */
                pageSize: number;
                search?: string;
                /** @default [] */
                sort: {
                    /** @default false */
                    desc: boolean;
                    field: string;
                }[];
            };
            /** @default false */
            isDefault: boolean;
            name: string;
            /**
             * @default private
             * @enum {string}
             */
            visibility: "private" | "unit";
        };
        SavedViewUpdateDto: {
            config?: {
                /** @default [] */
                columns: string[];
                filter?: {
                    items: ({
                        field: string;
                        /** @enum {string} */
                        op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                        value?: unknown;
                    } | {
                        items: ({
                            field: string;
                            /** @enum {string} */
                            op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                            value?: unknown;
                        } | {
                            items: ({
                                field: string;
                                /** @enum {string} */
                                op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                value?: unknown;
                            } | {
                                items: ({
                                    field: string;
                                    /** @enum {string} */
                                    op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                    value?: unknown;
                                } | {
                                    items: {
                                        field: string;
                                        /** @enum {string} */
                                        op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                        value?: unknown;
                                    }[];
                                    /**
                                     * @default and
                                     * @enum {string}
                                     */
                                    op: "and" | "or";
                                })[];
                                /**
                                 * @default and
                                 * @enum {string}
                                 */
                                op: "and" | "or";
                            })[];
                            /**
                             * @default and
                             * @enum {string}
                             */
                            op: "and" | "or";
                        })[];
                        /**
                         * @default and
                         * @enum {string}
                         */
                        op: "and" | "or";
                    })[];
                    /**
                     * @default and
                     * @enum {string}
                     */
                    op: "and" | "or";
                };
                /**
                 * @default table
                 * @enum {string}
                 */
                mode: "table" | "cards" | "board" | "calendar" | "pivot" | "dashboard";
                /** @default {} */
                options: {
                    [key: string]: unknown;
                };
                /** @default 20 */
                pageSize: number;
                search?: string;
                /** @default [] */
                sort: {
                    /** @default false */
                    desc: boolean;
                    field: string;
                }[];
            };
            isDefault?: boolean;
            name?: string;
            /** @enum {string} */
            visibility?: "private" | "unit";
        };
        ServiceOverrideDto: {
            enabled: boolean;
            reason: string;
        };
        SettingDto: {
            value: unknown;
        };
        StatementImportDto: {
            content: string;
            filename: string;
            issuer: string;
            /** Format: date */
            statementDate: string;
        };
        SubmissionCreateDto: {
            answers: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            draftId?: string;
            /** Format: uuid */
            formId: string;
            /** Format: uuid */
            formVersionId: string;
        };
        SubmissionExportDto: {
            fields?: string[];
            filter?: {
                items: ({
                    field: string;
                    /** @enum {string} */
                    op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                    value?: unknown;
                } | {
                    items: ({
                        field: string;
                        /** @enum {string} */
                        op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                        value?: unknown;
                    } | {
                        items: ({
                            field: string;
                            /** @enum {string} */
                            op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                            value?: unknown;
                        } | {
                            items: ({
                                field: string;
                                /** @enum {string} */
                                op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                value?: unknown;
                            } | {
                                items: {
                                    field: string;
                                    /** @enum {string} */
                                    op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                    value?: unknown;
                                }[];
                                /**
                                 * @default and
                                 * @enum {string}
                                 */
                                op: "and" | "or";
                            })[];
                            /**
                             * @default and
                             * @enum {string}
                             */
                            op: "and" | "or";
                        })[];
                        /**
                         * @default and
                         * @enum {string}
                         */
                        op: "and" | "or";
                    })[];
                    /**
                     * @default and
                     * @enum {string}
                     */
                    op: "and" | "or";
                })[];
                /**
                 * @default and
                 * @enum {string}
                 */
                op: "and" | "or";
            };
            /** Format: uuid */
            formId: string;
            /**
             * @default csv
             * @enum {string}
             */
            format: "csv" | "xlsx";
            search?: string;
            /** @default [] */
            sort: {
                /** @default false */
                desc: boolean;
                field: string;
            }[];
        };
        SubmissionQueryDto: {
            /** @default [] */
            aggregates: {
                alias?: string;
                field?: string;
                /** @enum {string} */
                fn: "count" | "sum" | "avg" | "min" | "max";
            }[];
            /** @default [] */
            facets: string[];
            filter?: {
                items: ({
                    field: string;
                    /** @enum {string} */
                    op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                    value?: unknown;
                } | {
                    items: ({
                        field: string;
                        /** @enum {string} */
                        op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                        value?: unknown;
                    } | {
                        items: ({
                            field: string;
                            /** @enum {string} */
                            op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                            value?: unknown;
                        } | {
                            items: ({
                                field: string;
                                /** @enum {string} */
                                op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                value?: unknown;
                            } | {
                                items: {
                                    field: string;
                                    /** @enum {string} */
                                    op: "eq" | "ne" | "contains" | "ncontains" | "starts" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "has" | "hasany" | "empty" | "notempty";
                                    value?: unknown;
                                }[];
                                /**
                                 * @default and
                                 * @enum {string}
                                 */
                                op: "and" | "or";
                            })[];
                            /**
                             * @default and
                             * @enum {string}
                             */
                            op: "and" | "or";
                        })[];
                        /**
                         * @default and
                         * @enum {string}
                         */
                        op: "and" | "or";
                    })[];
                    /**
                     * @default and
                     * @enum {string}
                     */
                    op: "and" | "or";
                })[];
                /**
                 * @default and
                 * @enum {string}
                 */
                op: "and" | "or";
            };
            /** Format: uuid */
            formId: string;
            groupBy?: {
                /** @enum {string} */
                bucket?: "year" | "month" | "day";
                field: string;
            };
            /** @default 1 */
            page: number;
            /** @default 20 */
            pageSize: number;
            /** @default true */
            rows: boolean;
            search?: string;
            /** @default [] */
            sort: {
                /** @default false */
                desc: boolean;
                field: string;
            }[];
            thenBy?: {
                /** @enum {string} */
                bucket?: "year" | "month" | "day";
                field: string;
            };
        };
        TransitionDto: {
            action: string;
            answers?: {
                [key: string]: unknown;
            };
            comment?: string;
        };
        VersionDto: {
            /** @default {} */
            defaults: {
                [key: string]: unknown;
            };
            /** Format: date */
            effectiveFrom?: string;
            /** @default null */
            feeRuleVersionId: string | null;
            /** @default null */
            formVersionId: string | null;
            /** @default {} */
            inputMap: {
                [key: string]: {
                    [key: string]: string;
                };
            };
            note?: string;
            /** @default {} */
            overridePolicy: {
                [key: string]: ("region" | "unit")[];
            };
            /** Format: uuid */
            workflowVersionId: string;
        };
        WorkflowCheckDto: {
            definition: {
                [key: string]: unknown;
            };
        };
        WorkflowCreateDto: {
            definition: {
                [key: string]: unknown;
            };
            key: string;
            name: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
        };
        WorkflowUpdateDto: {
            active?: boolean;
            name?: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
        };
        WorkflowVersionCreateDto: {
            definition: {
                [key: string]: unknown;
            };
        };
        WriteOffDto: {
            /** @enum {string} */
            endReason: "damaged" | "misprinted" | "lost" | "stolen" | "other";
            plates: {
                from: number;
                series: string;
                to: number;
            } | {
                keys: string[];
            };
            reason: string;
            /** @enum {string} */
            status: "void" | "lost";
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
    JobsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    JobsController_retry: {
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
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CasesController_list: {
        parameters: {
            query?: {
                list?: "waiting" | "recent";
                service?: string;
                state?: string;
                number?: number;
                mine?: "true" | "false";
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    FeesController_forCase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
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
    PaymentsController_forCase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
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
    CasesController_get: {
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
    CasesController_audit: {
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
                content: {
                    "application/json": components["schemas"]["CaseAuditOut_Output"];
                };
            };
        };
    };
    CasesController_comment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CommentDto"];
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
    CasesController_people: {
        parameters: {
            query?: {
                q?: string;
            };
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
    CasesController_claim: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                taskId: string;
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
    CasesController_release: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                taskId: string;
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
    CasesController_transition: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TransitionDto"];
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
    CompetencyController_grades: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    CompetencyController_list: {
        parameters: {
            query?: {
                personId?: string;
                status?: "pending_national" | "active" | "voided";
                number?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    CompetencyController_get: {
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
    CompetencyController_batches: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    CompetencyController_printed: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PrintedDto"];
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
    CompetencyController_send: {
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
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CompetencyController_enrolments: {
        parameters: {
            query?: {
                personId?: string;
                schoolId?: string;
                status?: "enrolled" | "completed";
                limit?: number;
            };
            header?: never;
            path?: never;
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
    CompetencyController_enrol: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnrolmentCreateDto"];
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
    CompetencyController_complete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnrolmentCompleteDto"];
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
    DocumentsController_header: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    ExternalPaymentsController_issuers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    ExternalPaymentsController_list: {
        parameters: {
            query?: {
                state?: "pending_verification" | "verified" | "rejected" | "revoked" | "withdrawn";
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    ExternalPaymentsController_decide: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefDecisionDto"];
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
    ExternalPaymentsController_revoke: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefRevocationDto"];
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
    ExternalPaymentsController_statements: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
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
    ExternalPaymentsController_importStatement: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StatementImportDto"];
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
    ExternalPaymentsController_statement: {
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
    ExternalPaymentsController_lines: {
        parameters: {
            query?: {
                all?: string;
                after?: number;
                limit?: number;
            };
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
    FeesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    FeesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FeeRuleCreateDto"];
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
    FeesController_check: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FeeRuleCheckDto"];
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
    FeesController_get: {
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
    FeesController_versions: {
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
    FeesController_addVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FeeRuleVersionDto"];
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
    FeesController_version: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                versionId: string;
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
    FeesController_decide: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FeeRuleDecisionDto"];
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
    FeesController_preview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FeePreviewDto"];
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
    FilesController_begin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FileUploadDto"];
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
    FilesController_get: {
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
    FilesController_confirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FileConfirmDto"];
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
    FilesController_download: {
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
    DraftsController_list: {
        parameters: {
            query?: {
                formId?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    DraftsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DraftCreateDto"];
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
    DraftsController_get: {
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
    DraftsController_remove: {
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
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DraftsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DraftUpdateDto"];
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
    PublicationsController_list: {
        parameters: {
            query?: {
                status?: "pending" | "approved" | "rejected" | "withdrawn";
                formId?: string;
                scope?: "all" | "mine" | "decidable";
                before?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    PublicationsController_count: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    PublicationsController_approve: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublicationDecisionDto"];
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
    PublicationsController_reject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublicationRejectionDto"];
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
    PublicationsController_review: {
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
    PublicationsController_withdraw: {
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
    FormsController_list: {
        parameters: {
            query?: {
                q?: string;
                active?: "true" | "false";
                owner?: string;
                kind?: "form" | "block";
                limit?: number;
            };
            header?: never;
            path?: never;
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
    FormsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FormCreateDto"];
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
    FormsController_get: {
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
    FormsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FormUpdateDto"];
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
    FormsController_locks: {
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
    FormsController_overlay: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                unitId: string;
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
    FormsController_saveOverlay: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                unitId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FormOverlayPutDto"];
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
    FormsController_requestOverlayPublication: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                unitId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublicationRequestDto"];
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
    FormsController_requestPublication: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublicationRequestDto"];
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
    FormsController_publishCheck: {
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
    FormsController_versions: {
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
    FormsController_published: {
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
    FormsController_version: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                versionId: string;
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
    FormsController_view: {
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
    FormsController_views: {
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
    FormsController_createView: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavedViewCreateDto"];
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
    DocumentsController_list: {
        parameters: {
            query?: {
                caseId?: string;
                subjectId?: string;
            };
            header?: never;
            path?: never;
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
    DocumentsController_download: {
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
    NotificationsController_list: {
        parameters: {
            query?: {
                before?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    NotificationsController_read: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReadDto"];
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
    IamController_preferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesDto"];
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
    SettingsController_setMine: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingDto"];
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
    SettingsController_resetMine: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    InboxController_list: {
        parameters: {
            query?: {
                claim?: "all" | "mine" | "unclaimed";
                sla?: "overdue" | "due-soon";
                state?: string;
                number?: number;
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    InboxController_count: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    IamController_workspace: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    IamController_assignments: {
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
    ServicesController_configuration: {
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
    ServicesController_setOverride: {
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
                "application/json": components["schemas"]["OverrideDto"];
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
    ServicesController_resetOverride: {
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
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SettingsController_forUnit: {
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
    SettingsController_setForUnit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingDto"];
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
    SettingsController_resetForUnit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
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
    OrganisationsController_search: {
        parameters: {
            query?: {
                q?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    OrganisationsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrganisationCreateDto"];
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
    OrganisationsController_get: {
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
    OrganisationsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrganisationUpdateDto"];
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
    OrganisationsController_addMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberAddDto"];
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
    OrganisationsController_endMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                memberId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberEndDto"];
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
    PaymentsController_list: {
        parameters: {
            query?: {
                state?: "open" | "settled" | "cancelled";
                collection?: "cashier" | "elsewhere";
                q?: number;
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    PaymentsController_get: {
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
    ExternalPaymentsController_enter: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefInputDto"];
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
    PaymentsController_record: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PaymentDto"];
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
    MergesController_list: {
        parameters: {
            query?: {
                status?: "pending" | "approved" | "rejected";
            };
            header?: never;
            path?: never;
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
    MergesController_request: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MergeRequestDto"];
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
    MergesController_approve: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MergeDecisionDto"];
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
    MergesController_reject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MergeDecisionDto"];
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
    PersonsController_search: {
        parameters: {
            query: {
                q: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    PersonsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PersonCreateDto"];
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
    PersonsController_duplicates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DuplicateCheckDto"];
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
    PersonsController_lookup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PersonLookupDto"];
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
    PersonsController_get: {
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
    PersonsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PersonUpdateDto"];
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
    PersonsController_reveal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RevealDto"];
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
    PlateStockController_allocate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AllocateDto"];
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
    PlateStockController_batches: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    PlateStockController_receive: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReceiveDto"];
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
    PlateStockController_batch: {
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
    PlateStockController_movements: {
        parameters: {
            query?: {
                unitId?: string;
                kind?: "receive" | "allocate" | "accept" | "recall" | "assign" | "retire" | "lose" | "write_off";
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    PlateStockController_movement: {
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
    PlateStockController_accept: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptDto"];
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
    PlateStockController_plates: {
        parameters: {
            query?: {
                q?: string;
                status?: "in_stock" | "allocated" | "reserved" | "assigned" | "retired" | "void" | "lost";
                holderUnitId?: string;
                caseId?: string;
                series?: string;
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    PlateStockController_recall: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecallDto"];
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
    PlateStockController_summary: {
        parameters: {
            query?: {
                unitId?: string;
            };
            header?: never;
            path?: never;
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
    PlateStockController_writeOff: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WriteOffDto"];
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
    VerificationController_keys: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    VerificationController_verify: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
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
    PaymentsController_reversals: {
        parameters: {
            query?: {
                state?: "requested" | "approved" | "rejected";
            };
            header?: never;
            path?: never;
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
    PaymentsController_decide: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReversalDecisionDto"];
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
    PaymentsController_receipt: {
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
    PaymentsController_requestReversal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReversalRequestDto"];
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
    RegistryLookupsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupProvidersOut_Output"];
                };
            };
        };
    };
    RegistryLookupsController_search: {
        parameters: {
            query: {
                q: string;
                limit?: number;
            };
            header?: never;
            path: {
                provider: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupItemsOut_Output"];
                };
            };
        };
    };
    RegistryLookupsController_items: {
        parameters: {
            query: {
                ids: string;
            };
            header?: never;
            path: {
                provider: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookupItemsOut_Output"];
                };
            };
        };
    };
    IamController_revoke: {
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
    IamController_grantRequests: {
        parameters: {
            query?: {
                unitId?: string;
            };
            header?: never;
            path?: never;
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
    IamController_requestGrant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GrantDto"];
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
    IamController_confirmGrant: {
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
    IamController_rejectGrant: {
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
                "application/json": components["schemas"]["DecisionDto"];
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
    SavedViewsController_remove: {
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
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SavedViewsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavedViewUpdateDto"];
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
    ServicesController_request: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestDto"];
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
    ServicesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    ServicesController_requestForm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
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
    ServicesController_versions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
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
    ServicesController_publish: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VersionDto"];
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
    StationeryController_allocate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AllocateDto"];
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
    StationeryController_batches: {
        parameters: {
            query?: {
                kind?: "libre_booklet" | "licence_blank" | "bolo_sticker" | "receipt_leaf";
            };
            header?: never;
            path?: never;
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
    StationeryController_receive: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReceiveDto"];
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
    StationeryController_closings: {
        parameters: {
            query?: {
                kind?: "libre_booklet" | "licence_blank" | "bolo_sticker" | "receipt_leaf";
            };
            header?: never;
            path?: never;
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
    StationeryController_close: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ClosingDto"];
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
    StationeryController_items: {
        parameters: {
            query?: {
                kind?: "libre_booklet" | "licence_blank" | "bolo_sticker" | "receipt_leaf";
                variant?: string;
                q?: string;
                status?: "in_stock" | "allocated" | "used" | "spoiled" | "void" | "missing";
                holderUnitId?: string;
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    StationeryController_movements: {
        parameters: {
            query?: {
                kind?: "libre_booklet" | "licence_blank" | "bolo_sticker" | "receipt_leaf";
                unitId?: string;
                movement?: "receive" | "allocate" | "accept" | "recall" | "use" | "spoil" | "write_off";
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    StationeryController_movement: {
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
    StationeryController_accept: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptDto"];
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
    StationeryController_recall: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecallDto"];
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
    StationeryController_summary: {
        parameters: {
            query: {
                kind: "libre_booklet" | "licence_blank" | "bolo_sticker" | "receipt_leaf";
                unitId?: string;
            };
            header?: never;
            path?: never;
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
    StationeryController_writeOff: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WriteOffDto"];
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
    ExportsController_request: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmissionExportDto"];
            };
        };
        responses: {
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ExportsController_get: {
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
    ExportsController_download: {
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
    SubmissionsController_list: {
        parameters: {
            query?: {
                formId?: string;
                mine?: "true" | "false";
                before?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    SubmissionsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmissionCreateDto"];
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
    SubmissionsController_export: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmissionExportDto"];
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
    SubmissionsController_query: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmissionQueryDto"];
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
    SubmissionsController_get: {
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
    SubmissionsController_history: {
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
    SubmissionsController_reveal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RevealDto"];
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
    SettingsController_setForUnitType: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingDto"];
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
    SettingsController_resetForUnitType: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    VehicleCategoriesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
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
    VehiclesController_search: {
        parameters: {
            query?: {
                q?: string;
                ownerId?: string;
                status?: "active" | "transferred_out" | "deregistered" | "stolen";
                after?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    VehiclesController_get: {
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
    WorkflowDefinitionsController_list: {
        parameters: {
            query?: {
                q?: string;
                active?: "true" | "false";
                owner?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
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
    WorkflowDefinitionsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkflowCreateDto"];
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
    WorkflowDefinitionsController_check: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkflowCheckDto"];
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
    WorkflowDefinitionsController_get: {
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
    WorkflowDefinitionsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkflowUpdateDto"];
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
    WorkflowDefinitionsController_versions: {
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
    WorkflowDefinitionsController_addVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkflowVersionCreateDto"];
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
    WorkflowDefinitionsController_version: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                versionId: string;
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
