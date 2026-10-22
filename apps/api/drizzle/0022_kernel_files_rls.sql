-- Uploaded files (task 0.15), hand-written: the scope trigger, checks, grants and RLS (class T: the uploading unit's
-- subtree). Keys are the server's (quarantine/<region>/<id>, files/<region>/<id>); a name is display only (SEC-IN-9).
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."files"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "kernel"."files"
    ADD CONSTRAINT "files_status_check" CHECK ("status" IN ('pending', 'stored', 'rejected', 'expired')),
    ADD CONSTRAINT "files_type_check"
        CHECK ("content_type" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
    ADD CONSTRAINT "files_size_check" CHECK ("size" BETWEEN 1 AND 52428800),
    ADD CONSTRAINT "files_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "files_name_check" CHECK (length("filename") BETWEEN 1 AND 200 AND "filename" !~ '[/\\[:cntrl:]]'),
    ADD CONSTRAINT "files_key_check"
        CHECK ("object_key" ~ '^(quarantine|files)/[0-9a-f-]{36}/[0-9a-f-]{36}$' AND "object_key" LIKE '%/' || "id"::text),
    ADD CONSTRAINT "files_document_type_check" CHECK ("document_type" ~ '^[a-z][a-z0-9_]{1,40}$'),
    ADD CONSTRAINT "files_link_check" CHECK (("linked_table" IS NULL) = ("linked_id" IS NULL)),
    ADD CONSTRAINT "files_stored_check" CHECK (("status" = 'stored') = ("confirmed_at" IS NOT NULL)),
    ADD CONSTRAINT "files_reason_check" CHECK (coalesce(length("reject_reason"), 0) <= 40);
--> statement-breakpoint
GRANT SELECT, INSERT ON "kernel"."files" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "object_key", "upload_id", "document_type", "linked_table", "linked_id", "expires_at",
    "confirmed_at", "reject_reason", "updated_at", "updated_by", "row_version")
    ON "kernel"."files" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.files', 'transaction', 'org_path');
