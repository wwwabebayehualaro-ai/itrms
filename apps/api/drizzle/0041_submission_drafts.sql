CREATE TABLE "forms"."submission_drafts" (
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
	"answers" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forms"."submission_drafts" ADD CONSTRAINT "submission_drafts_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."submission_drafts" ADD CONSTRAINT "submission_drafts_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."submission_drafts" ADD CONSTRAINT "submission_drafts_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "forms"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_drafts_creator_idx" ON "forms"."submission_drafts" USING btree ("created_by","form_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submission_drafts_org_path_gist" ON "forms"."submission_drafts" USING gist ("org_path");