CREATE TABLE "competency"."vehicle_import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"import_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"state" text NOT NULL,
	"paper_reference" text,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sensitive_ct" "bytea",
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vin_key" text,
	"plate_key" text,
	"owner_key" "bytea",
	"scan_file_id" uuid,
	"owner_person_id" uuid,
	"vehicle_id" uuid,
	CONSTRAINT "vehicle_import_rows_state_check" CHECK (line >= 2 AND (state IN ('imported', 'already_imported')) = (vehicle_id IS NOT NULL)
                        AND (state <> 'invalid' OR jsonb_array_length(errors) > 0)
                        AND (state = 'invalid' OR jsonb_array_length(errors) = 0))
);
--> statement-breakpoint
CREATE TABLE "competency"."vehicle_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"filename" text NOT NULL,
	"format" text NOT NULL,
	"state" text DEFAULT 'checking' NOT NULL,
	"failure_code" text,
	"failure_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_ct" "bytea",
	"scan_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language" text NOT NULL,
	"roles" text[] NOT NULL,
	"committed_by" uuid,
	"commit_unit_id" uuid,
	"commit_roles" text[],
	"committed_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	CONSTRAINT "vehicle_imports_state_check" CHECK ((state = 'failed') = (failure_code IS NOT NULL)
                        AND (state IN ('committing', 'committed')) = (committed_by IS NOT NULL)
                        AND (committed_by IS NULL) = (committed_at IS NULL)
                        AND (committed_by IS NULL) = (commit_unit_id IS NULL)
                        AND (committed_by IS NULL OR committed_by IS DISTINCT FROM created_by)
                        AND jsonb_array_length(scan_file_ids) <= 2000)
);
--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" DROP CONSTRAINT "vehicles_migration_check";--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "migration_import_row_id" uuid;--> statement-breakpoint
ALTER TABLE "competency"."vehicle_import_rows" ADD CONSTRAINT "vehicle_import_rows_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."vehicle_import_rows" ADD CONSTRAINT "vehicle_import_rows_import_id_vehicle_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "competency"."vehicle_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."vehicle_imports" ADD CONSTRAINT "vehicle_imports_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."vehicle_imports" ADD CONSTRAINT "vehicle_imports_commit_unit_id_org_units_id_fk" FOREIGN KEY ("commit_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_import_rows_line_uq" ON "competency"."vehicle_import_rows" USING btree ("import_id","line");--> statement-breakpoint
CREATE INDEX "vehicle_import_rows_state_idx" ON "competency"."vehicle_import_rows" USING btree ("import_id","state","line");--> statement-breakpoint
CREATE INDEX "vehicle_import_rows_owner_idx" ON "competency"."vehicle_import_rows" USING btree ("import_id","owner_key") WHERE owner_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "vehicle_import_rows_org_path_gist" ON "competency"."vehicle_import_rows" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "vehicle_imports_unit_idx" ON "competency"."vehicle_imports" USING btree ("handling_unit_id","created_at");--> statement-breakpoint
CREATE INDEX "vehicle_imports_org_path_gist" ON "competency"."vehicle_imports" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_migration_import_row_uq" ON "vehicles"."vehicles" USING btree ("migration_import_row_id") WHERE "vehicles"."vehicles"."migration_import_row_id" is not null;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_migration_check" CHECK (("vehicles"."vehicles"."migration_source" is null) = ("vehicles"."vehicles"."paper_reference" is null)
                        and coalesce(length("vehicles"."vehicles"."paper_reference"), 1) between 1 and 60
                        and ("vehicles"."vehicles"."migration_source" is distinct from 'back_capture'
                             or ("vehicles"."vehicles"."migration_case_id" is not null and "vehicles"."vehicles"."migration_verified_by" is not null
                                 and "vehicles"."vehicles"."migration_verified_at" is not null))
                        and ("vehicles"."vehicles"."migration_source" is distinct from 'import'
                             or ("vehicles"."vehicles"."migration_import_row_id" is not null and "vehicles"."vehicles"."migration_verified_by" is not null))
                        and ("vehicles"."vehicles"."migration_import_row_id" is null or "vehicles"."vehicles"."migration_source" = 'import')
                        and ("vehicles"."vehicles"."migration_verified_by" is null) = ("vehicles"."vehicles"."migration_verified_at" is null));--> statement-breakpoint
-- The hand-written part (task 1.13b): the lists a text column takes; the other slices' foreign keys (the scan a row uses, the
-- person and the vehicle its commit made, the row an imported vehicle came from); the importing office's path; what the app may
-- change (a batch's state and, once read, its cleared sheet; a row's outcome at the commit), never a row's facts nor the
-- migration columns of a vehicle; the transaction class (the importing office's subtree reads and writes).
ALTER TABLE "competency"."vehicle_imports" ADD CONSTRAINT "vehicle_imports_enums_check"
    CHECK ("format" IN ('csv', 'xlsx')
       AND "state" IN ('checking', 'checked', 'failed', 'committing', 'committed', 'discarded')
       AND ("failure_code" IS NULL OR "failure_code" IN ('unreadable', 'too_large', 'no_rows', 'too_many_rows',
                                                         'missing_columns', 'not_permitted'))
       AND length("filename") BETWEEN 1 AND 200 AND "language" IN ('am', 'en', 'wal-Latn')
       AND ("content_ct" IS NULL OR "state" = 'checking'));
--> statement-breakpoint
ALTER TABLE "competency"."vehicle_import_rows" ADD CONSTRAINT "vehicle_import_rows_enums_check"
    CHECK ("state" IN ('valid', 'invalid', 'already_imported', 'imported')
       AND coalesce(length("paper_reference"), 1) BETWEEN 1 AND 60 AND jsonb_array_length("errors") <= 100);
--> statement-breakpoint
ALTER TABLE "competency"."vehicle_import_rows" ADD CONSTRAINT "vehicle_import_rows_scan_fk"
    FOREIGN KEY ("scan_file_id") REFERENCES "kernel"."files"("id");
--> statement-breakpoint
ALTER TABLE "competency"."vehicle_import_rows" ADD CONSTRAINT "vehicle_import_rows_person_fk"
    FOREIGN KEY ("owner_person_id") REFERENCES "parties"."persons"("id");
--> statement-breakpoint
ALTER TABLE "competency"."vehicle_import_rows" ADD CONSTRAINT "vehicle_import_rows_vehicle_fk"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id");
--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_migration_import_row_fk"
    FOREIGN KEY ("migration_import_row_id") REFERENCES "competency"."vehicle_import_rows"("id");
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."vehicle_imports"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."vehicle_import_rows"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."vehicle_imports", "competency"."vehicle_import_rows" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "failure_code", "failure_columns", "content_ct", "committed_by", "commit_unit_id", "commit_roles",
    "committed_at", "checked_at", "updated_at", "updated_by", "row_version")
    ON "competency"."vehicle_imports" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "errors", "owner_person_id", "vehicle_id", "updated_at", "updated_by", "row_version")
    ON "competency"."vehicle_import_rows" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.vehicle_imports', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.vehicle_import_rows', 'transaction', 'org_path');
