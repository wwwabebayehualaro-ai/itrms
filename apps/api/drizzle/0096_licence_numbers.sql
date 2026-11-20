CREATE TABLE "competency"."licence_health" (
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
	"blood_group_ct" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competency"."driver_licences" ADD COLUMN "card_serial" text;--> statement-breakpoint
ALTER TABLE "competency"."licence_health" ADD CONSTRAINT "licence_health_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_health" ADD CONSTRAINT "licence_health_licence_id_driver_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "competency"."driver_licences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "licence_health_licence_uq" ON "competency"."licence_health" USING btree ("licence_id");--> statement-breakpoint
CREATE INDEX "licence_health_handling_org_path_gist" ON "competency"."licence_health" USING gist ("handling_org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_licences_card_serial_uq" ON "competency"."driver_licences" USING btree ("region_id","card_serial") WHERE card_serial IS NOT NULL;
--> statement-breakpoint
-- Hand-written (task 1.6, ADR-0051, ADR-0052, ADR-0064). The card serial beside the number: as the stationery keeps a blank's key
-- (capitals or the Ethiopic series letters the stationery allows, digits, '-'), set when a printed batch comes back, by the office
-- that handles the licence.
ALTER TABLE "competency"."driver_licences" ADD CONSTRAINT "driver_licences_card_serial_check"
    CHECK ("card_serial" IS NULL OR "card_serial" ~ '^[A-Zሀ-ፚ0-9-]{1,20}$');
--> statement-breakpoint
GRANT UPDATE ("card_serial") ON "competency"."driver_licences" TO itrms_app;
--> statement-breakpoint
-- The blood group (ADR-0052): class R like its licence, one row per licence, only a ciphertext (the field crypto's envelope); it is
-- recorded and corrected, never deleted by the API, and the audit log never holds it (the table's audit policy omits it).
ALTER TABLE "competency"."licence_health" ADD CONSTRAINT "licence_health_ciphertext_check"
    CHECK (octet_length("blood_group_ct") > 16);
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."licence_health"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."licence_health" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("blood_group_ct", "handling_unit_id", "updated_at", "updated_by", "row_version")
    ON "competency"."licence_health" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.licence_health', 'registry', 'handling_org_path');
--> statement-breakpoint
-- Whether the caller's region has its regional licence counter (ADR-0064 §2): the counter is on the region's root unit, past an
-- office's RLS (class T), so the filing asks this. It answers yes or no, only for the licence counter's key and only for the
-- caller's own region; any other key is no.
CREATE FUNCTION "kernel"."regional_counter_ready"(p_key text) RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT p_key = 'competency.licence' AND kernel.ctx_region() IS NOT NULL AND EXISTS (
        SELECT 1 FROM kernel.number_counters c
          JOIN kernel.org_units u ON u.id = c.unit_id
         WHERE c.key = p_key AND u.parent_id IS NULL
           AND u.region_id = kernel.ctx_region() AND c.region_id = kernel.ctx_region()
           -- the region's own pattern, not an office's that the root unit happens to hold
           AND position('{unit}' IN c.pattern) = 0);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "kernel"."regional_counter_ready"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "kernel"."regional_counter_ready"(text) TO itrms_app;