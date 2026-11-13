CREATE TABLE "competency"."bolo_inspections" (
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
	"vehicle_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"checklist_serial" text NOT NULL,
	"inspected_on" date NOT NULL,
	"passed" boolean NOT NULL,
	"failed_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"garage_id" uuid,
	"repaired_on" date,
	"repair_note" text,
	CONSTRAINT "bolo_inspections_attempt_check" CHECK (attempt >= 1 AND (attempt = 1) = (garage_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "competency"."bolos" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competency"."bolo_inspections" ADD CONSTRAINT "bolo_inspections_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bolo_inspections_attempt_uq" ON "competency"."bolo_inspections" USING btree ("case_id","attempt");--> statement-breakpoint
CREATE INDEX "bolo_inspections_vehicle_idx" ON "competency"."bolo_inspections" USING btree ("vehicle_id","inspected_on");--> statement-breakpoint
CREATE INDEX "bolo_inspections_garage_idx" ON "competency"."bolo_inspections" USING btree ("garage_id") WHERE garage_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bolo_inspections_org_path_gist" ON "competency"."bolo_inspections" USING gist ("org_path");--> statement-breakpoint
-- The hand-written part (task 1.3b): the case's vehicle and the garage are other slices' records; the handling unit's path;
-- the register is written once (no UPDATE grant); the transaction class (the handling office's subtree reads and writes it).
-- A bolo's reminded_at is the worker's (itrms_system): the app is given no UPDATE on it.
ALTER TABLE "competency"."bolo_inspections" ADD CONSTRAINT "bolo_inspections_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id");
--> statement-breakpoint
ALTER TABLE "competency"."bolo_inspections" ADD CONSTRAINT "bolo_inspections_garage_fk" FOREIGN KEY ("garage_id") REFERENCES "parties"."organisations"("id");
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."bolo_inspections"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."bolo_inspections" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.bolo_inspections', 'transaction', 'org_path');
