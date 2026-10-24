CREATE TABLE "kernel"."files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"upload_id" text,
	"document_type" text,
	"linked_table" text,
	"linked_id" uuid,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"reject_reason" text
);
--> statement-breakpoint
ALTER TABLE "kernel"."files" ADD CONSTRAINT "files_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_org_path_gist" ON "kernel"."files" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "files_linked_idx" ON "kernel"."files" USING btree ("linked_table","linked_id");--> statement-breakpoint
CREATE INDEX "files_purge_idx" ON "kernel"."files" USING btree ("expires_at") WHERE "kernel"."files"."status" in ('pending', 'rejected');--> statement-breakpoint
CREATE INDEX "files_created_by_idx" ON "kernel"."files" USING btree ("created_by","status");