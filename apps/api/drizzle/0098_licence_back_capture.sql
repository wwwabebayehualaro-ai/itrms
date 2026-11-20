CREATE TABLE "competency"."licence_number_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"case_id" uuid NOT NULL,
	"number" text NOT NULL,
	"reason" text NOT NULL,
	"paper_reference" text NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "competency"."driver_licences" ADD COLUMN "migration_source" text;--> statement-breakpoint
ALTER TABLE "competency"."driver_licences" ADD COLUMN "paper_reference" text;--> statement-breakpoint
ALTER TABLE "competency"."driver_licences" ADD COLUMN "issued_by" text;--> statement-breakpoint
ALTER TABLE "competency"."driver_licences" ADD COLUMN "migration_case_id" uuid;--> statement-breakpoint
ALTER TABLE "competency"."driver_licences" ADD COLUMN "migration_verified_by" uuid;--> statement-breakpoint
ALTER TABLE "competency"."driver_licences" ADD COLUMN "migration_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competency"."licence_number_flags" ADD CONSTRAINT "licence_number_flags_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "licence_number_flags_case_uq" ON "competency"."licence_number_flags" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "licence_number_flags_org_path_gist" ON "competency"."licence_number_flags" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "licence_number_flags_number_idx" ON "competency"."licence_number_flags" USING btree ("region_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_licences_migration_case_uq" ON "competency"."driver_licences" USING btree ("migration_case_id") WHERE migration_case_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "competency"."driver_licences" ADD CONSTRAINT "driver_licences_migration_check" CHECK (migration_source IS NULL OR (paper_reference IS NOT NULL AND migration_case_id IS NOT NULL AND migration_verified_by IS NOT NULL AND migration_verified_at IS NOT NULL));--> statement-breakpoint
-- Hand-written (task 1.6b, ADR-0054, ADR-0051 §4). A licence captured from its paper file is inserted once, verified, and never
-- re-marked: the migration columns take no UPDATE grant. Its printed number is kept as printed (folded to capitals).
ALTER TABLE "competency"."driver_licences" ADD CONSTRAINT "driver_licences_migration_source_check"
    CHECK ("migration_source" IS NULL OR "migration_source" = 'back_capture');
--> statement-breakpoint
-- A printed number a capture could not keep, flagged to the bureau: class T at the capturing office (the offices above read it),
-- one per capture's case, never changed or deleted by the API.
ALTER TABLE "competency"."licence_number_flags" ADD CONSTRAINT "licence_number_flags_reason_check"
    CHECK ("reason" IN ('in_regional_range', 'number_taken'));
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."licence_number_flags"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."licence_number_flags" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.licence_number_flags', 'transaction', 'org_path');
