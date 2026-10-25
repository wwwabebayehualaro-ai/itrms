CREATE TABLE "forms"."submission_exports" (
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
	"request" jsonb NOT NULL,
	"roles" text[] NOT NULL,
	"language" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"rows" integer,
	"file_id" uuid,
	"error" text,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "kernel"."files" ADD COLUMN "origin" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "forms"."submission_exports" ADD CONSTRAINT "submission_exports_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."submission_exports" ADD CONSTRAINT "submission_exports_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."submission_exports" ADD CONSTRAINT "submission_exports_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "kernel"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_exports_creator_idx" ON "forms"."submission_exports" USING btree ("created_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submission_exports_org_path_gist" ON "forms"."submission_exports" USING gist ("org_path");