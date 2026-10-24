-- The value table of filterable fields (task 0.16b, ADR-0035), hand-written: the scope trigger, checks, grants and RLS
-- (class T at the submission's handling unit, like the submission). The API only adds and reads rows; the worker's
-- system role fills them for existing submissions.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."submission_values"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
ALTER TABLE "forms"."submission_values"
    ADD CONSTRAINT "submission_values_one_value_check"
        CHECK (num_nonnulls("value_text", "value_num", "value_date", "value_ts", "value_bool") = 1),
    ADD CONSTRAINT "submission_values_key_check" CHECK ("field_key" ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
    ADD CONSTRAINT "submission_values_text_check" CHECK (coalesce(length("value_text"), 0) <= 500),
    ADD CONSTRAINT "submission_values_ordinal_check" CHECK ("ordinal" BETWEEN 0 AND 999);
--> statement-breakpoint
ALTER TABLE "forms"."form_definitions"
    ADD CONSTRAINT "form_definitions_indexed_keys_check" CHECK (cardinality("indexed_keys") <= 200);
--> statement-breakpoint
GRANT SELECT, INSERT ON "forms"."submission_values" TO itrms_app;
--> statement-breakpoint
-- an approval drops the keys a new version no longer marks filterable
GRANT UPDATE ("indexed_keys") ON "forms"."form_definitions" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('forms.submission_values', 'transaction', 'org_path');
