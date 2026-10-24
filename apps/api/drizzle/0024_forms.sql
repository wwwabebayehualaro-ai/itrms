CREATE SCHEMA "forms";
--> statement-breakpoint
CREATE TABLE "forms"."form_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"category" text,
	"active" boolean DEFAULT true NOT NULL,
	"document" jsonb NOT NULL,
	"document_hash" text NOT NULL,
	"document_updated_by" uuid,
	"published_version_id" uuid,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forms"."form_publications" (
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
	"content_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text
);
--> statement-breakpoint
CREATE TABLE "forms"."form_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"form_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms"."submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"form_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"case_id" uuid,
	"answers" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forms"."form_definitions" ADD CONSTRAINT "form_definitions_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_definitions" ADD CONSTRAINT "form_definitions_published_version_id_form_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "forms"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_publications" ADD CONSTRAINT "form_publications_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_publications" ADD CONSTRAINT "form_publications_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_publications" ADD CONSTRAINT "form_publications_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "forms"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_versions" ADD CONSTRAINT "form_versions_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_versions" ADD CONSTRAINT "form_versions_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."submissions" ADD CONSTRAINT "submissions_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."submissions" ADD CONSTRAINT "submissions_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."submissions" ADD CONSTRAINT "submissions_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "forms"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_definitions_key_uq" ON "forms"."form_definitions" USING btree ("region_id","key");--> statement-breakpoint
CREATE INDEX "form_definitions_org_path_gist" ON "forms"."form_definitions" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "form_publications_pending_uq" ON "forms"."form_publications" USING btree ("form_id") WHERE "forms"."form_publications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "form_publications_org_path_gist" ON "forms"."form_publications" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_content_uq" ON "forms"."form_versions" USING btree ("form_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_number_uq" ON "forms"."form_versions" USING btree ("form_id","number");--> statement-breakpoint
CREATE INDEX "form_versions_org_path_gist" ON "forms"."form_versions" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "submissions_form_idx" ON "forms"."submissions" USING btree ("form_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submissions_form_creator_idx" ON "forms"."submissions" USING btree ("form_id","created_by","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submissions_version_idx" ON "forms"."submissions" USING btree ("form_version_id");--> statement-breakpoint
CREATE INDEX "submissions_case_idx" ON "forms"."submissions" USING btree ("case_id") WHERE "forms"."submissions"."case_id" is not null;--> statement-breakpoint
CREATE INDEX "submissions_org_path_gist" ON "forms"."submissions" USING gist ("org_path");