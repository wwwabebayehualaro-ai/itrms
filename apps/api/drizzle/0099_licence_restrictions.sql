CREATE TABLE "competency"."licence_restrictions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"licence_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"authority" text NOT NULL,
	"authority_reference" text NOT NULL,
	"decided_on" date NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "licence_restrictions_kind_check" CHECK (kind in ('suspension', 'cancellation')),
	CONSTRAINT "licence_restrictions_authority_check" CHECK (authority in ('court', 'traffic_police', 'penalty_system', 'licensing_body')),
	CONSTRAINT "licence_restrictions_period_check" CHECK ((kind = 'suspension') = (ends_on IS NOT NULL) AND (ends_on IS NULL OR ends_on >= starts_on) AND starts_on >= decided_on)
);
--> statement-breakpoint
ALTER TABLE "competency"."licence_restrictions" ADD CONSTRAINT "licence_restrictions_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_restrictions" ADD CONSTRAINT "licence_restrictions_licence_id_driver_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "competency"."driver_licences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "licence_restrictions_case_uq" ON "competency"."licence_restrictions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "licence_restrictions_licence_idx" ON "competency"."licence_restrictions" USING btree ("licence_id","starts_on");--> statement-breakpoint
CREATE INDEX "licence_restrictions_handling_org_path_gist" ON "competency"."licence_restrictions" USING gist ("handling_org_path");--> statement-breakpoint
-- Hand-written (task 1.6c, ADR-0064 §6). A suspension or cancellation recorded from its deciding authority: class R like its
-- licence and with its handling unit (the region reads it, the licence office's subtree records it), inserted once by the approval
-- step, never changed or deleted by the API. A cancellation sets the licence's status to 'cancelled' (the status UPDATE grant of 0058).
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."licence_restrictions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."licence_restrictions" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.licence_restrictions', 'registry', 'handling_org_path');
