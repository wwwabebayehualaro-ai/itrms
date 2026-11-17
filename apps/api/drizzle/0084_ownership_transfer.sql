CREATE TABLE "competency"."ownership_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"case_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"seller_ownership_id" uuid NOT NULL,
	"acquired_by" text NOT NULL,
	"code3" boolean DEFAULT false NOT NULL,
	"valued_on" date,
	"valued_by" uuid,
	"inspection_note" text,
	"purchase_price_santim" bigint,
	"depreciation_percent" numeric(5, 2),
	"market_value_santim" bigint,
	"committee_value_santim" bigint,
	"contract_value_santim" bigint,
	"valuers" text,
	"letters_issued_on" date,
	"contract_reference" text,
	"contract_authenticated_on" date,
	"stamp_duty_receipt" text,
	"stamp_duty_paid_on" date,
	"tax_registration_reference" text,
	"court_reference" text,
	"evidence_recorded_by" uuid,
	"evidence_recorded_at" timestamp with time zone,
	"buyer_ownership_id" uuid,
	"cancelled_libre_id" uuid,
	"new_libre_id" uuid,
	"transferred_on" date,
	"transferred_by" uuid,
	CONSTRAINT "ownership_transfers_amounts_check" CHECK (coalesce(purchase_price_santim, 1) > 0 and coalesce(market_value_santim, 1) > 0
                        and coalesce(committee_value_santim, 1) > 0 and coalesce(contract_value_santim, 1) > 0
                        and coalesce(depreciation_percent, 0) between 0 and 100),
	CONSTRAINT "ownership_transfers_text_check" CHECK (coalesce(length(inspection_note), 1) between 1 and 500 and coalesce(length(valuers), 1) between 1 and 200
                        and coalesce(length(contract_reference), 1) between 1 and 60
                        and coalesce(length(stamp_duty_receipt), 1) between 1 and 60
                        and coalesce(length(tax_registration_reference), 1) between 1 and 60
                        and coalesce(length(court_reference), 1) between 1 and 60),
	CONSTRAINT "ownership_transfers_result_check" CHECK ((buyer_ownership_id is null) = (transferred_on is null) and (transferred_on is null) = (transferred_by is null)),
	CONSTRAINT "ownership_transfers_evidence_check" CHECK ((evidence_recorded_by is null) = (evidence_recorded_at is null))
);
--> statement-breakpoint
ALTER TABLE "competency"."ownership_transfers" ADD CONSTRAINT "ownership_transfers_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_transfers_case_uq" ON "competency"."ownership_transfers" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "ownership_transfers_vehicle_idx" ON "competency"."ownership_transfers" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "ownership_transfers_handling_org_path_gist" ON "competency"."ownership_transfers" USING gist ("handling_org_path");
--> statement-breakpoint
-- The hand-written part (task 1.4b). The case, the vehicle, the periods and the libres are other slices' records; the values a
-- transfer can have been acquired by; the handling unit's path; what the app may write (nothing is deleted: only the columns the
-- valuation, the papers and the result are written through); the class: transaction, at the handling office (the case's working
-- is the office's; the region reads the vehicle and its owners, which are the registry's).
ALTER TABLE "competency"."ownership_transfers"
    ADD CONSTRAINT "ownership_transfers_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases"("id"),
    ADD CONSTRAINT "ownership_transfers_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id"),
    ADD CONSTRAINT "ownership_transfers_seller_fk" FOREIGN KEY ("seller_ownership_id") REFERENCES "vehicles"."vehicle_ownerships"("id"),
    ADD CONSTRAINT "ownership_transfers_buyer_fk" FOREIGN KEY ("buyer_ownership_id") REFERENCES "vehicles"."vehicle_ownerships"("id"),
    ADD CONSTRAINT "ownership_transfers_cancelled_libre_fk" FOREIGN KEY ("cancelled_libre_id") REFERENCES "vehicles"."libres"("id"),
    ADD CONSTRAINT "ownership_transfers_new_libre_fk" FOREIGN KEY ("new_libre_id") REFERENCES "vehicles"."libres"("id"),
    ADD CONSTRAINT "ownership_transfers_acquired_by_check"
        CHECK ("acquired_by" IN ('sale', 'gift', 'inheritance', 'court_order', 'auction'));
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."ownership_transfers"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."ownership_transfers" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("valued_on", "valued_by", "inspection_note", "purchase_price_santim", "depreciation_percent",
    "market_value_santim", "committee_value_santim", "contract_value_santim", "valuers", "letters_issued_on",
    "contract_reference", "contract_authenticated_on", "stamp_duty_receipt", "stamp_duty_paid_on",
    "tax_registration_reference", "court_reference", "evidence_recorded_by", "evidence_recorded_at",
    "buyer_ownership_id", "cancelled_libre_id", "new_libre_id", "transferred_on", "transferred_by",
    "updated_at", "updated_by", "row_version") ON "competency"."ownership_transfers" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.ownership_transfers', 'transaction', 'handling_org_path');
--> statement-breakpoint
-- Follow-up of task 1.4a: a transfer through the register's command left the former owners' libre issued. A libre in force on a
-- period that has ended is cancelled. Expected to change no row: the register has had no transfer through a case until now, and
-- the seeds and tests transfer only to check the command. Done as the owner role, so it is not an audited write; had it found
-- rows, they would be what this change makes impossible.
UPDATE "vehicles"."libres" l SET "status" = 'cancelled'
  FROM "vehicles"."vehicle_ownerships" o
 WHERE o."id" = l."ownership_id" AND o."until" IS NOT NULL AND l."status" = 'issued';
--> statement-breakpoint
-- The libre in force belongs to the vehicle's open ownership period, whatever writes the rows (a libre is issued, or a period ends).
-- Deferred, because a transfer ends the period, cancels the libre and issues the next one in separate statements.
CREATE FUNCTION "vehicles"."check_libre_in_force"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM vehicles.libres l
          JOIN vehicles.vehicle_ownerships o ON o.id = l.ownership_id
         WHERE l.vehicle_id = NEW.vehicle_id AND l.status = 'issued' AND o.until IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'vehicles: the libre in force of vehicle % is for owners who no longer hold it', NEW.vehicle_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'libre_in_force';
    END IF;
    RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "libre_in_force" AFTER INSERT OR UPDATE OF "status", "ownership_id" ON "vehicles"."libres"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_libre_in_force"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "libre_in_force" AFTER UPDATE OF "until" ON "vehicles"."vehicle_ownerships"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_libre_in_force"();
--> statement-breakpoint
-- A pending transfer claims its vehicle: the lookup of 0073 with one more arm, for the facts a transfer's filing keeps. While a
-- transfer case is open (submitted, until closed) a plate exchange or a second transfer of the vehicle is refused, whichever
-- office filed it. Same signature, so the grants and SECURITY DEFINER stand.
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
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{exchange,vehicleId}') = p_vehicle_id::text)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{transfer,vehicleId}') = p_vehicle_id::text)
    );
$$;
--> statement-breakpoint
CREATE INDEX "cases_open_transfer_vehicle_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{transfer,vehicleId}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{transfer,vehicleId}') IS NOT NULL;
