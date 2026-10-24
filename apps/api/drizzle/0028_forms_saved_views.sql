CREATE TABLE "forms"."saved_views" (
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
	"name" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forms"."saved_views" ADD CONSTRAINT "saved_views_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."saved_views" ADD CONSTRAINT "saved_views_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_views_form_unit_idx" ON "forms"."saved_views" USING btree ("form_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_default_uq" ON "forms"."saved_views" USING btree ("form_id","unit_id") WHERE "forms"."saved_views"."is_default";--> statement-breakpoint
CREATE INDEX "saved_views_org_path_gist" ON "forms"."saved_views" USING gist ("org_path");