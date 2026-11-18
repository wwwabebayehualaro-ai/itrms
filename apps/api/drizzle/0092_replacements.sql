CREATE TABLE "competency"."replacements" (
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
	"item" text NOT NULL,
	"reason" text NOT NULL,
	"police_report_reference" text,
	"police_report_on" date,
	"notice_newspaper" text,
	"notice_published_on" date,
	"notice_ends_on" date,
	"old_libre_id" uuid,
	"new_libre_id" uuid,
	"bolo_id" uuid,
	"old_sticker_key" text,
	"new_sticker_key" text,
	"old_plate_assignment_id" uuid,
	"new_plate_assignment_id" uuid,
	"replaced_on" date,
	"replaced_by" uuid,
	CONSTRAINT "replacements_item_check" CHECK (item in ('libre', 'bolo', 'plate')),
	CONSTRAINT "replacements_reason_check" CHECK (reason in ('lost', 'stolen', 'damaged')),
	CONSTRAINT "replacements_police_check" CHECK (reason = 'damaged' or (police_report_reference is not null and police_report_on is not null)),
	CONSTRAINT "replacements_notice_check" CHECK (item <> 'libre' or reason = 'damaged' or notice_published_on is not null),
	CONSTRAINT "replacements_result_check" CHECK ((replaced_on is null) = (replaced_by is null))
);
--> statement-breakpoint
ALTER TABLE "vehicles"."plate_assignments" DROP CONSTRAINT "plate_assignments_reason_check";--> statement-breakpoint
ALTER TABLE "competency"."replacements" ADD CONSTRAINT "replacements_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "replacements_case_uq" ON "competency"."replacements" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "replacements_vehicle_idx" ON "competency"."replacements" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "replacements_handling_org_path_gist" ON "competency"."replacements" USING gist ("handling_org_path");--> statement-breakpoint
ALTER TABLE "vehicles"."plate_assignments" ADD CONSTRAINT "plate_assignments_reason_check" CHECK ("vehicles"."plate_assignments"."ended_reason" in ('exchanged', 'lost', 'retired', 'transferred', 'stolen', 'damaged'));
--> statement-breakpoint
-- The hand-written part (task 1.5, ADR-0062). The case, the vehicle, the libres, the bolo and the plate assignments are other
-- records; the handling unit's path; what the app may write (nothing is deleted: only the columns the result is written through);
-- the class: transaction, at the handling office (the case's working is the office's). The plate end reasons above gain stolen and
-- damaged (a plate replacement, task 1.5c).
ALTER TABLE "competency"."replacements"
    ADD CONSTRAINT "replacements_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases"("id"),
    ADD CONSTRAINT "replacements_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id"),
    ADD CONSTRAINT "replacements_old_libre_fk" FOREIGN KEY ("old_libre_id") REFERENCES "vehicles"."libres"("id"),
    ADD CONSTRAINT "replacements_new_libre_fk" FOREIGN KEY ("new_libre_id") REFERENCES "vehicles"."libres"("id"),
    ADD CONSTRAINT "replacements_bolo_fk" FOREIGN KEY ("bolo_id") REFERENCES "competency"."bolos"("id"),
    ADD CONSTRAINT "replacements_old_plate_fk" FOREIGN KEY ("old_plate_assignment_id") REFERENCES "vehicles"."plate_assignments"("id"),
    ADD CONSTRAINT "replacements_new_plate_fk" FOREIGN KEY ("new_plate_assignment_id") REFERENCES "vehicles"."plate_assignments"("id");
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."replacements"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."replacements" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("old_libre_id", "new_libre_id", "bolo_id", "old_sticker_key", "new_sticker_key", "old_plate_assignment_id",
    "new_plate_assignment_id", "notice_ends_on", "replaced_on", "replaced_by", "updated_at", "updated_by", "row_version")
    ON "competency"."replacements" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.replacements', 'transaction', 'handling_org_path');
--> statement-breakpoint
-- A pending replacement claims its vehicle: the lookup of 0091 with one more arm, for the facts a replacement's filing keeps. While
-- a replacement case is open (submitted, until closed) a plate exchange, a transfer or a second replacement of the vehicle is
-- refused, whichever office filed it. Same signature, so the grants and SECURITY DEFINER stand.
CREATE OR REPLACE FUNCTION "competency"."vehicle_in_open_case"(p_vin_key text, p_make_key text, p_plate_key text, p_vehicle_id uuid, p_except uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT kernel.ctx_region() IS NULL OR (
        EXISTS (SELECT 1 FROM workflow.cases c
                 WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                   AND p_vin_key IS NOT NULL AND (c.facts #>> '{registration,vinKey}') = p_vin_key
                   AND (p_make_key IS NULL OR (c.facts #>> '{registration,makeKey}') IS NULL
                        OR (c.facts #>> '{registration,makeKey}') = p_make_key))
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vin_key IS NOT NULL AND (c.facts #>> '{backCapture,vinKey}') = p_vin_key
                      AND (p_make_key IS NULL OR (c.facts #>> '{backCapture,makeKey}') IS NULL
                           OR (c.facts #>> '{backCapture,makeKey}') = p_make_key))
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_plate_key IS NOT NULL AND (c.facts #>> '{backCapture,plateKey}') = p_plate_key)
        OR EXISTS (SELECT 1 FROM workflow.cases c
                    WHERE c.region_id = kernel.ctx_region() AND c.closed_at IS NULL AND c.id IS DISTINCT FROM p_except
                      AND p_vin_key IS NOT NULL AND (c.facts #>> '{transferArrival,vinKey}') = p_vin_key
                      AND (p_make_key IS NULL OR (c.facts #>> '{transferArrival,makeKey}') IS NULL
                           OR (c.facts #>> '{transferArrival,makeKey}') = p_make_key))
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
                      AND p_vehicle_id IS NOT NULL AND (c.facts #>> '{replacement,vehicleId}') = p_vehicle_id::text)
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
REVOKE ALL ON FUNCTION "competency"."vehicle_in_open_case"(text, text, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "competency"."vehicle_in_open_case"(text, text, text, uuid, uuid) TO itrms_app;
--> statement-breakpoint
CREATE INDEX "cases_open_replacement_vehicle_idx" ON "workflow"."cases" ("region_id", ("facts" #>> '{replacement,vehicleId}'))
    WHERE "closed_at" IS NULL AND ("facts" #>> '{replacement,vehicleId}') IS NOT NULL;