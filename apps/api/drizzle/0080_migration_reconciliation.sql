CREATE TABLE "competency"."migration_paper_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"plate_code" text NOT NULL,
	"count" integer NOT NULL,
	"counted_on" date NOT NULL,
	"counted_by_unit_id" uuid NOT NULL,
	CONSTRAINT "migration_paper_counts_check" CHECK (count BETWEEN 0 AND 10000000)
);
--> statement-breakpoint
ALTER TABLE "competency"."migration_samples" ADD COLUMN "scan_file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "competency"."migration_paper_counts" ADD CONSTRAINT "migration_paper_counts_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."migration_paper_counts" ADD CONSTRAINT "migration_paper_counts_counted_by_unit_id_org_units_id_fk" FOREIGN KEY ("counted_by_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "migration_paper_counts_uq" ON "competency"."migration_paper_counts" USING btree ("handling_unit_id","plate_code");--> statement-breakpoint
CREATE INDEX "migration_paper_counts_org_path_gist" ON "competency"."migration_paper_counts" USING gist ("org_path");--> statement-breakpoint
-- every page of a scan kept before task 1.13h was its first only (before the check needs it)
UPDATE "competency"."migration_samples" SET "scan_file_ids" = ARRAY["scan_file_id"] WHERE "scan_file_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "competency"."migration_samples" ADD CONSTRAINT "migration_samples_scans_check" CHECK ((scan_file_id IS NULL) = (cardinality(scan_file_ids) = 0)
                        AND (scan_file_id IS NULL OR scan_file_ids[1] = scan_file_id) AND cardinality(scan_file_ids) <= 20);
--> statement-breakpoint
-- The hand-written part (task 1.13h): the list of plate codes a text column takes; the counted office's path; what the app may
-- change (a count's number, its day and who counted), never its office nor its code; the transaction class (the counted office's
-- subtree reads and writes, and the offices above it).
ALTER TABLE "competency"."migration_paper_counts" ADD CONSTRAINT "migration_paper_counts_enums_check"
    CHECK ("plate_code" IN ('1', '2', '3', '4', '5', '35', 'other'));
--> statement-breakpoint
-- an office never counts its own files (the service also requires the counter to be above it)
ALTER TABLE "competency"."migration_paper_counts" ADD CONSTRAINT "migration_paper_counts_counter_check"
    CHECK ("counted_by_unit_id" <> "handling_unit_id");
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."migration_paper_counts"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."migration_paper_counts" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("count", "counted_on", "counted_by_unit_id", "updated_at", "updated_by", "row_version")
    ON "competency"."migration_paper_counts" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.migration_paper_counts', 'transaction', 'org_path');
