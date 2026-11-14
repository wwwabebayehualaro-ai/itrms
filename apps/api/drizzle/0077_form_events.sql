CREATE TABLE "forms"."form_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"form_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"fill" uuid NOT NULL,
	"kind" text NOT NULL,
	"field_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"step" text,
	"seconds" integer
);
--> statement-breakpoint
ALTER TABLE "forms"."form_events" ADD CONSTRAINT "form_events_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_events" ADD CONSTRAINT "form_events_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_events" ADD CONSTRAINT "form_events_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "forms"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_events_form_idx" ON "forms"."form_events" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_events_fill_idx" ON "forms"."form_events" USING btree ("form_id","fill");--> statement-breakpoint
CREATE INDEX "form_events_org_path_gist" ON "forms"."form_events" USING gist ("org_path");--> statement-breakpoint
-- The hand-written part (task 1.13f): the filing unit's path; written once (no UPDATE or DELETE grant); the kinds and bounds;
-- the transaction class (the filing unit's subtree reads and writes, the offices above read).
ALTER TABLE "forms"."form_events" ADD CONSTRAINT "form_events_kind_check"
    CHECK ("kind" IN ('opened', 'step', 'blocked', 'refused', 'submitted'));
--> statement-breakpoint
ALTER TABLE "forms"."form_events" ADD CONSTRAINT "form_events_bounds_check"
    CHECK (cardinality("field_keys") <= 200 AND ("seconds" IS NULL OR "seconds" BETWEEN 0 AND 604800));
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."form_events"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
GRANT SELECT, INSERT ON "forms"."form_events" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('forms.form_events', 'transaction', 'org_path');
