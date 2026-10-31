CREATE TABLE "forms"."submission_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"submission_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"form_version_id" uuid NOT NULL,
	"answers" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forms"."submission_revisions" ADD CONSTRAINT "submission_revisions_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."submission_revisions" ADD CONSTRAINT "submission_revisions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "forms"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."submission_revisions" ADD CONSTRAINT "submission_revisions_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "forms"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_revisions_uq" ON "forms"."submission_revisions" USING btree ("submission_id","revision");--> statement-breakpoint
CREATE INDEX "submission_revisions_org_path_gist" ON "forms"."submission_revisions" USING gist ("org_path");--> statement-breakpoint
-- Hand-written (task 0.21e): a case's request changes through its workflow. The API may replace a request's answers (and
-- nothing else of it), only on a submission filed with a case; what each change replaced is kept in the append-only
-- revisions; the filterable values of the changed request are written again. The owner and the system role (a retention
-- job's anonymisation, SEC-PD-3) are not bound by the trigger, as the counters' triggers bind only itrms_app.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."submission_revisions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
ALTER TABLE "forms"."submission_revisions"
    ADD CONSTRAINT "submission_revisions_revision_check" CHECK ("revision" >= 1),
    ADD CONSTRAINT "submission_revisions_answers_check" CHECK (
        jsonb_typeof("answers") = 'object' AND pg_column_size("answers") <= 1048576);
--> statement-breakpoint
CREATE FUNCTION "forms"."submissions_answers_of_cases"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF current_user = 'itrms_app' AND NEW.answers IS DISTINCT FROM OLD.answers AND OLD.case_id IS NULL THEN
        RAISE EXCEPTION 'forms.submissions: only the request of a case is ever changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "submissions_answers_of_cases" BEFORE UPDATE ON "forms"."submissions"
    FOR EACH ROW EXECUTE FUNCTION "forms"."submissions_answers_of_cases"();
--> statement-breakpoint
GRANT SELECT, INSERT ON "forms"."submission_revisions" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("answers", "updated_at", "updated_by", "row_version") ON "forms"."submissions" TO itrms_app;
--> statement-breakpoint
GRANT DELETE ON "forms"."submission_values" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('forms.submission_revisions', 'transaction', 'org_path');
