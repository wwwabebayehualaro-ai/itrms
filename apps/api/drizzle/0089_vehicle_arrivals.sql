CREATE TABLE "vehicles"."vehicle_arrivals" (
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
	"returned" boolean DEFAULT false NOT NULL,
	"handover_id" uuid,
	"document_number" text NOT NULL,
	"document_key" text NOT NULL,
	"issuing_region" text NOT NULL,
	"issuing_region_key" text NOT NULL,
	"issuing_office" text NOT NULL,
	"document_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"verified_how" text NOT NULL,
	"arrived_on" date NOT NULL,
	"carried_plate_text" text,
	"carried_plate_key" text,
	"bolo_valid_until" date,
	"holds_listed" boolean DEFAULT false NOT NULL,
	"holds_note" text,
	CONSTRAINT "vehicle_arrivals_verified_check" CHECK ("vehicles"."vehicle_arrivals"."verified_how" in ('verification_page', 'letter')),
	CONSTRAINT "vehicle_arrivals_dates_check" CHECK ("vehicles"."vehicle_arrivals"."valid_until" >= "vehicles"."vehicle_arrivals"."document_date"),
	CONSTRAINT "vehicle_arrivals_words_check" CHECK (length("vehicles"."vehicle_arrivals"."document_number") between 1 and 60 and length("vehicles"."vehicle_arrivals"."document_key") between 1 and 60 and length("vehicles"."vehicle_arrivals"."issuing_region") between 1 and 100 and length("vehicles"."vehicle_arrivals"."issuing_region_key") between 1 and 100 and length("vehicles"."vehicle_arrivals"."issuing_office") between 1 and 200),
	CONSTRAINT "vehicle_arrivals_plate_check" CHECK (("vehicles"."vehicle_arrivals"."carried_plate_text" is null) = ("vehicles"."vehicle_arrivals"."carried_plate_key" is null)),
	CONSTRAINT "vehicle_arrivals_holds_note_check" CHECK (coalesce(length("vehicles"."vehicle_arrivals"."holds_note"), 1) between 1 and 500),
	CONSTRAINT "vehicle_arrivals_returned_check" CHECK ("vehicles"."vehicle_arrivals"."returned" or "vehicles"."vehicle_arrivals"."handover_id" is null)
);
--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_ownerships" DROP CONSTRAINT "vehicle_ownerships_acquired_check";--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_arrivals" ADD CONSTRAINT "vehicle_arrivals_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_arrivals" ADD CONSTRAINT "vehicle_arrivals_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_arrivals" ADD CONSTRAINT "vehicle_arrivals_handover_id_vehicle_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "vehicles"."vehicle_handovers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_arrivals_case_uq" ON "vehicles"."vehicle_arrivals" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_arrivals_document_uq" ON "vehicles"."vehicle_arrivals" USING btree ("region_id","issuing_region_key","document_key");--> statement-breakpoint
CREATE INDEX "vehicle_arrivals_vehicle_idx" ON "vehicles"."vehicle_arrivals" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_arrivals_handling_gist" ON "vehicles"."vehicle_arrivals" USING gist ("handling_org_path");--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_acquired_check" CHECK ("vehicles"."vehicle_ownerships"."acquired_by" in ('first_registration', 'sale', 'inheritance', 'gift', 'court_order', 'auction', 'back_capture', 'transfer_in'));
--> statement-breakpoint
-- Hand-written (task 1.4c3, ADR-0060): the transfer document a vehicle arrived on from another region. Like the register's other child
-- rows it takes its region and handling office from its vehicle (the names sort so the office is set before the path), and only the
-- arrival case writes it, once: no UPDATE is granted.
CREATE TRIGGER "inherit_vehicle_unit" BEFORE INSERT ON "vehicles"."vehicle_arrivals"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."inherit_vehicle_unit"('vehicle');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."vehicle_arrivals"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
GRANT SELECT, INSERT ON "vehicles"."vehicle_arrivals" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.vehicle_arrivals', 'registry', 'handling_org_path');
--> statement-breakpoint
-- An arriving vehicle claims its chassis and its plate (task 1.4c3): another registration, back-capture or arrival of the same chassis,
-- or a back-capture or arrival of the same plate, is refused while one is open. The body of 0088 with two arms more; same signature,
-- so the grants and SECURITY DEFINER stand.
CREATE OR REPLACE FUNCTION "competency"."vehicle_in_open_case"(p_vin_key text, p_plate_key text, p_vehicle_id uuid, p_except uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT kernel.ctx_region() IS NULL OR (
        EXISTS (SELECT 1 FROM workflow.cases c
                 WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                   AND p_vin_key IS NOT NULL AND (c.facts #>> '{registration,vinKey}') = p_vin_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vin_key IS NOT NULL AND (c.facts #>> '{backCapture,vinKey}') = p_vin_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_plate_key IS NOT NULL AND (c.facts #>> '{backCapture,plateKey}') = p_plate_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vin_key IS NOT NULL AND (c.facts #>> '{transferArrival,vinKey}') = p_vin_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_plate_key IS NOT NULL AND (c.facts #>> '{transferArrival,plateKey}') = p_plate_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{exchange,vehicleId}') = p_vehicle_id::text)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{transfer,vehicleId}') = p_vehicle_id::text)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{transferOut,vehicleId}') = p_vehicle_id::text)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                     JOIN vehicles.vehicle_handovers r ON r.id::text = (c.facts #>> '{transferIn,handoverId}')
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{transferIn,vehicleId}') = p_vehicle_id::text
                      AND r.status = 'released' AND r.valid_until >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{cancelRelease,vehicleId}') = p_vehicle_id::text)
        OR EXISTS (SELECT 1 FROM vehicles.vehicle_handovers h
                    WHERE h.region_id = kernel.ctx_region() AND p_vehicle_id IS NOT NULL AND h.vehicle_id = p_vehicle_id
                      AND h.status = 'released' AND h.valid_until >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date
                      AND NOT EXISTS (SELECT 1 FROM workflow.cases x
                                       WHERE x.id = p_except AND x.handling_unit_id = h.to_unit_id))
    );
$$;
--> statement-breakpoint
CREATE INDEX "cases_open_transfer_arrival_vin_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{transferArrival,vinKey}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{transferArrival,vinKey}') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "cases_open_transfer_arrival_plate_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{transferArrival,plateKey}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{transferArrival,plateKey}') IS NOT NULL;