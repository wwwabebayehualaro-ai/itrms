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
        get?: never;
        put?: never;
        post: operations["CasesController_start"];
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
    "/api/v1/role-assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IamController_grant"];
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
    "/api/v1/settings/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SettingsController_get"];
        put: operations["SettingsController_set"];
        post?: never;
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
        patch?: never;
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
        CaseStartDto: {
            /** Format: uuid */
            workflowId: string;
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
            name: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
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
        RenameUnitDto: {
            name: {
                am: string;
                en: string;
            } & {
                [key: string]: string;
            };
        };
        RevealDto: {
            fields: ("birthDate" | "phone" | "fin")[];
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
        WorkflowVersionCreateDto: {
            definition: {
                [key: string]: unknown;
            };
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
    CasesController_start: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseStartDto"];
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
    IamController_grant: {
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
    SettingsController_get: {
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
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SettingsController_set: {
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
    WorkflowDefinitionsController_list: {
        parameters: {
            query?: {
                q?: string;
                active?: "true" | "false";
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
