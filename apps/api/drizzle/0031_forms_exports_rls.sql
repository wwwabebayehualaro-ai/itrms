-- Background exports and server-generated files (task 0.16e), hand-written.
-- A generated file is the server's (an export; the documents of task 0.23): only it may be a CSV or an Excel workbook,
-- and an upload stays one of the four types its bytes are checked against.
ALTER TABLE "kernel"."files" DROP CONSTRAINT "files_type_check";
--> statement-breakpoint
ALTER TABLE "kernel"."files"
    ADD CONSTRAINT "files_origin_check" CHECK ("origin" IN ('upload', 'generated')),
    ADD CONSTRAINT "files_type_check" CHECK (
        ("origin" = 'upload' AND "content_type" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'))
        OR ("origin" = 'generated' AND "content_type" IN ('text/csv',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf'))),
    -- a generated file is stored at once: it never waits in quarantine
    ADD CONSTRAINT "files_generated_check" CHECK ("origin" = 'upload' OR ("status" IN ('stored', 'expired')
        AND "object_key" LIKE 'files/%'));
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."submission_exports"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "forms"."submission_exports"
    ADD CONSTRAINT "submission_exports_status_check" CHECK ("status" IN ('queued', 'running', 'done', 'failed')),
    ADD CONSTRAINT "submission_exports_done_check" CHECK (("status" = 'done') = ("file_id" IS NOT NULL)),
    ADD CONSTRAINT "submission_exports_finished_check" CHECK (
        ("status" IN ('done', 'failed')) = ("finished_at" IS NOT NULL)),
    ADD CONSTRAINT "submission_exports_text_check" CHECK (
        coalesce(length("error"), 0) <= 500 AND "language" IN ('am', 'en', 'wal-Latn')
        AND cardinality("roles") <= 50 AND coalesce("rows", 0) >= 0),
    ADD CONSTRAINT "submission_exports_request_check" CHECK (
        jsonb_typeof("request") = 'object' AND pg_column_size("request") <= 65536);
--> statement-breakpoint
GRANT SELECT, INSERT ON "forms"."submission_exports" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "rows", "file_id", "error", "finished_at", "updated_at", "updated_by", "row_version")
    ON "forms"."submission_exports" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('forms.submission_exports', 'transaction', 'org_path');
