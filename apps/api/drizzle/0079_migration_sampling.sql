CREATE TABLE "competency"."migration_sample_counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"clerk_id" uuid NOT NULL,
	"records" integer DEFAULT 0 NOT NULL,
	"drawn" integer DEFAULT 0 NOT NULL,
	"share" integer NOT NULL,
	"block_size" integer NOT NULL,
	"block_position" integer DEFAULT 0 NOT NULL,
	"block_picks" integer[] DEFAULT '{}'::integer[] NOT NULL,
	CONSTRAINT "migration_sample_counters_check" CHECK (share BETWEEN 0 AND 100 AND block_size BETWEEN 1 AND 100
                        AND block_position BETWEEN 0 AND block_size AND cardinality(block_picks) <= block_size
                        AND drawn BETWEEN 0 AND records)
);
--> statement-breakpoint
CREATE TABLE "competency"."migration_samples" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"source" text NOT NULL,
	"case_id" uuid,
	"import_row_id" uuid,
	"clerk_id" uuid NOT NULL,
	"verifier_id" uuid NOT NULL,
	"scan_file_id" uuid,
	"share" integer NOT NULL,
	"state" text DEFAULT 'drawn' NOT NULL,
	"outcome" text,
	"error_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"rechecked_by" uuid,
	"rechecked_at" timestamp with time zone,
	CONSTRAINT "migration_samples_check" CHECK ((source = 'back_capture') = (case_id IS NOT NULL) AND (source = 'import') = (import_row_id IS NOT NULL)
                        AND clerk_id <> verifier_id AND share BETWEEN 1 AND 100
                        AND (state = 'rechecked') = (rechecked_by IS NOT NULL)
                        AND (rechecked_by IS NULL) = (rechecked_at IS NULL)
                        AND (rechecked_by IS NULL) = (outcome IS NULL)
                        AND rechecked_by IS DISTINCT FROM clerk_id AND rechecked_by IS DISTINCT FROM verifier_id
                        AND (outcome IS NOT DISTINCT FROM 'errors') = (cardinality(error_fields) > 0)
                        AND cardinality(error_fields) <= 40
                        AND coalesce(length(note), 1) BETWEEN 1 AND 500 AND (note IS NULL OR state = 'rechecked'))
);
--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" DROP CONSTRAINT "vehicles_migration_check";--> statement-breakpoint
ALTER TABLE "competency"."vehicle_imports" ADD COLUMN "commit_event_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "migration_import_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "migration_import_name" text;--> statement-breakpoint
ALTER TABLE "competency"."migration_sample_counters" ADD CONSTRAINT "migration_sample_counters_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."migration_samples" ADD CONSTRAINT "migration_samples_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."migration_samples" ADD CONSTRAINT "migration_samples_import_row_id_vehicle_import_rows_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "competency"."vehicle_import_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "migration_sample_counters_clerk_uq" ON "competency"."migration_sample_counters" USING btree ("handling_unit_id","clerk_id");--> statement-breakpoint
CREATE INDEX "migration_sample_counters_org_path_gist" ON "competency"."migration_sample_counters" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_samples_vehicle_uq" ON "competency"."migration_samples" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "migration_samples_queue_idx" ON "competency"."migration_samples" USING btree ("handling_unit_id","state","created_at");--> statement-breakpoint
CREATE INDEX "migration_samples_clerk_idx" ON "competency"."migration_samples" USING btree ("clerk_id","handling_unit_id");--> statement-breakpoint
CREATE INDEX "migration_samples_org_path_gist" ON "competency"."migration_samples" USING gist ("org_path");--> statement-breakpoint
ALTER TABLE "competency"."vehicle_imports" ADD CONSTRAINT "vehicle_imports_commit_event_check" CHECK (commit_event_id IS NULL OR state IN ('committing', 'committed'));--> statement-breakpoint
-- the commit job of a batch being committed before task 1.13g (the latest one for it), so a dead one can be given back
UPDATE "competency"."vehicle_imports" i SET "commit_event_id" = (
    SELECT e."id" FROM "kernel"."outbox_events" e
     WHERE e."type" = 'vehicle-import.commit-requested.v1' AND e."payload" ->> 'importId' = i."id"::text
     ORDER BY e."created_at" DESC LIMIT 1)
  WHERE i."state" = 'committing';--> statement-breakpoint
-- the batch of a vehicle imported before task 1.13g, from its row (before the check needs it)
UPDATE "vehicles"."vehicles" v SET "migration_import_id" = r."import_id", "migration_import_name" = i."filename"
    FROM "competency"."vehicle_import_rows" r JOIN "competency"."vehicle_imports" i ON i."id" = r."import_id"
    WHERE r."id" = v."migration_import_row_id";--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_migration_check" CHECK (("vehicles"."vehicles"."migration_source" is null) = ("vehicles"."vehicles"."paper_reference" is null)
                        and coalesce(length("vehicles"."vehicles"."paper_reference"), 1) between 1 and 60
                        and ("vehicles"."vehicles"."migration_source" is distinct from 'back_capture'
                             or ("vehicles"."vehicles"."migration_case_id" is not null and "vehicles"."vehicles"."migration_verified_by" is not null
                                 and "vehicles"."vehicles"."migration_verified_at" is not null))
                        and ("vehicles"."vehicles"."migration_source" is distinct from 'import'
                             or ("vehicles"."vehicles"."migration_import_row_id" is not null and "vehicles"."vehicles"."migration_verified_by" is not null))
                        and ("vehicles"."vehicles"."migration_import_row_id" is null or "vehicles"."vehicles"."migration_source" = 'import')
                        and ("vehicles"."vehicles"."migration_import_row_id" is null) = ("vehicles"."vehicles"."migration_import_id" is null)
                        and ("vehicles"."vehicles"."migration_import_id" is null) = ("vehicles"."vehicles"."migration_import_name" is null)
                        and coalesce(length("vehicles"."vehicles"."migration_import_name"), 1) between 1 and 200
                        and ("vehicles"."vehicles"."migration_verified_by" is null) = ("vehicles"."vehicles"."migration_verified_at" is null));
--> statement-breakpoint
-- The hand-written part (task 1.13g): the lists a text column takes; the other slices' foreign keys (the vehicle drawn, the case
-- that captured it, its scan, the batch an imported vehicle came from); the capturing office's path; what the app may change (a
-- counter's draw, a sample's re-check, a batch's commit job), never a sample's draw nor a vehicle's migration columns; the
-- transaction class (the capturing office's subtree reads and writes).
ALTER TABLE "competency"."migration_samples" ADD CONSTRAINT "migration_samples_enums_check"
    CHECK ("source" IN ('back_capture', 'import') AND "state" IN ('drawn', 'rechecked')
       AND ("outcome" IS NULL OR "outcome" IN ('correct', 'errors'))
       AND "error_fields" <@ ARRAY['paper_reference', 'first_registered_on', 'owners_since', 'plate', 'libre', 'federal_vehicle_id', 'chassis_number', 'engine_number', 'make', 'model', 'model_year', 'category', 'use', 'capacity', 'colour', 'fuel', 'owners', 'scan']::text[]);
--> statement-breakpoint
ALTER TABLE "competency"."migration_samples" ADD CONSTRAINT "migration_samples_vehicle_fk"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id");
--> statement-breakpoint
ALTER TABLE "competency"."migration_samples" ADD CONSTRAINT "migration_samples_case_fk"
    FOREIGN KEY ("case_id") REFERENCES "workflow"."cases"("id");
--> statement-breakpoint
ALTER TABLE "competency"."migration_samples" ADD CONSTRAINT "migration_samples_scan_fk"
    FOREIGN KEY ("scan_file_id") REFERENCES "kernel"."files"("id");
--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_migration_import_fk"
    FOREIGN KEY ("migration_import_id") REFERENCES "competency"."vehicle_imports"("id");
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."migration_sample_counters"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."migration_samples"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."migration_sample_counters", "competency"."migration_samples" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("records", "drawn", "share", "block_size", "block_position", "block_picks", "updated_at", "updated_by",
    "row_version")
    ON "competency"."migration_sample_counters" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "outcome", "error_fields", "note", "rechecked_by", "rechecked_at", "updated_at", "updated_by",
    "row_version")
    ON "competency"."migration_samples" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("commit_event_id") ON "competency"."vehicle_imports" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.migration_sample_counters', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.migration_samples', 'transaction', 'org_path');
