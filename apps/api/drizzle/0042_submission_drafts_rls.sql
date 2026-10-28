-- A person's drafts of a request (task 0.20c), hand-written: the scope trigger, checks, grants and RLS (class T at the
-- unit it was started in). Whose a draft is (`created_by`) is the service's rule, not a policy: a unit move rewrites every
-- row's scope as the API, and a policy on the creator would leave other people's drafts behind.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."submission_drafts"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "forms"."submission_drafts"
    ADD CONSTRAINT "submission_drafts_answers_check" CHECK (
        jsonb_typeof("answers") = 'object' AND pg_column_size("answers") <= 262144),
    ADD CONSTRAINT "submission_drafts_creator_check" CHECK ("created_by" IS NOT NULL);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "forms"."submission_drafts" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("form_version_id", "answers", "updated_at", "updated_by", "row_version")
    ON "forms"."submission_drafts" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('forms.submission_drafts', 'transaction', 'org_path');
