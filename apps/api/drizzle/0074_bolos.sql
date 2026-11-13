CREATE TABLE "competency"."bolos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"status" text DEFAULT 'awaiting_sticker' NOT NULL,
	"use" text NOT NULL,
	"checklist_serial" text NOT NULL,
	"inspected_on" date NOT NULL,
	"fiscal_year" integer NOT NULL,
	"valid_until" date NOT NULL,
	"insurance_certificate" text NOT NULL,
	"insurer" text NOT NULL,
	"insured_from" date NOT NULL,
	"insured_until" date NOT NULL,
	"sticker_key" text,
	"temporary_until" date,
	"void_reason" text,
	CONSTRAINT "bolos_status_check" CHECK ((status <> 'valid' OR sticker_key IS NOT NULL) AND (status <> 'temporary' OR temporary_until IS NOT NULL) AND (status <> 'void' OR void_reason IS NOT NULL)),
	CONSTRAINT "bolos_dates_check" CHECK (valid_until >= inspected_on AND insured_until >= insured_from)
);
--> statement-breakpoint
ALTER TABLE "competency"."bolos" ADD CONSTRAINT "bolos_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bolos_case_uq" ON "competency"."bolos" USING btree ("case_id") WHERE status <> 'void';--> statement-breakpoint
CREATE UNIQUE INDEX "bolos_sticker_uq" ON "competency"."bolos" USING btree ("region_id","sticker_key") WHERE sticker_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bolos_vehicle_idx" ON "competency"."bolos" USING btree ("vehicle_id","valid_until");--> statement-breakpoint
CREATE INDEX "bolos_handling_org_path_gist" ON "competency"."bolos" USING gist ("handling_org_path");
--> statement-breakpoint
-- The hand-written part (task 1.3a): the vehicle is another slice's record; the statuses a bolo has; the handling unit's path;
-- what the app may write; the registry class (the region reads a bolo, the handling unit's subtree writes it).
ALTER TABLE "competency"."bolos" ADD CONSTRAINT "bolos_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id");
--> statement-breakpoint
ALTER TABLE "competency"."bolos" ADD CONSTRAINT "bolos_status_values_check"
    CHECK ("status" IN ('awaiting_sticker', 'temporary', 'valid', 'void'));
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."bolos"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."bolos" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "sticker_key", "temporary_until", "void_reason", "updated_at", "updated_by", "row_version")
    ON "competency"."bolos" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.bolos', 'registry', 'handling_org_path');
