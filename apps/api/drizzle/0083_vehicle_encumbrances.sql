CREATE TABLE "vehicles"."vehicle_encumbrances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"recorded_unit_id" uuid NOT NULL,
	"recorded_org_path" "ltree" DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"holder_organisation_id" uuid NOT NULL,
	"letter_reference" text NOT NULL,
	"letter_date" date NOT NULL,
	"amount_santim" bigint,
	"note" text,
	"letter_file_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"release_reference" text,
	"release_date" date,
	"release_file_id" uuid,
	"release_note" text,
	"release_requested_by" uuid,
	"release_requested_at" timestamp with time zone,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_refusal_reason" text,
	CONSTRAINT "vehicle_encumbrances_kind_check" CHECK ("vehicles"."vehicle_encumbrances"."kind" in ('bank_loan', 'court_order', 'revenue_hold', 'customs_hold', 'insurance_hold')),
	CONSTRAINT "vehicle_encumbrances_status_check" CHECK ("vehicles"."vehicle_encumbrances"."status" in ('open', 'release_pending', 'released')),
	CONSTRAINT "vehicle_encumbrances_text_check" CHECK (length("vehicles"."vehicle_encumbrances"."letter_reference") between 1 and 60 and coalesce(length("vehicles"."vehicle_encumbrances"."note"), 1) between 1 and 500
                        and coalesce(length("vehicles"."vehicle_encumbrances"."release_reference"), 1) between 1 and 60
                        and coalesce(length("vehicles"."vehicle_encumbrances"."release_note"), 1) between 1 and 500
                        and coalesce(length("vehicles"."vehicle_encumbrances"."release_refusal_reason"), 10) between 10 and 500
                        and coalesce("vehicles"."vehicle_encumbrances"."amount_santim", 1) > 0),
	CONSTRAINT "vehicle_encumbrances_status_fields_check" CHECK (("vehicles"."vehicle_encumbrances"."status" = 'open' and "vehicles"."vehicle_encumbrances"."release_reference" is null and "vehicles"."vehicle_encumbrances"."release_date" is null
                            and "vehicles"."vehicle_encumbrances"."release_file_id" is null and "vehicles"."vehicle_encumbrances"."release_note" is null and "vehicles"."vehicle_encumbrances"."release_requested_by" is null
                            and "vehicles"."vehicle_encumbrances"."release_requested_at" is null and "vehicles"."vehicle_encumbrances"."released_by" is null and "vehicles"."vehicle_encumbrances"."released_at" is null)
                        or ("vehicles"."vehicle_encumbrances"."status" = 'release_pending' and "vehicles"."vehicle_encumbrances"."release_reference" is not null and "vehicles"."vehicle_encumbrances"."release_date" is not null
                            and "vehicles"."vehicle_encumbrances"."release_requested_by" is not null and "vehicles"."vehicle_encumbrances"."release_requested_at" is not null
                            and "vehicles"."vehicle_encumbrances"."released_by" is null and "vehicles"."vehicle_encumbrances"."released_at" is null and "vehicles"."vehicle_encumbrances"."release_refusal_reason" is null)
                        or ("vehicles"."vehicle_encumbrances"."status" = 'released' and "vehicles"."vehicle_encumbrances"."release_reference" is not null and "vehicles"."vehicle_encumbrances"."release_date" is not null
                            and "vehicles"."vehicle_encumbrances"."release_requested_by" is not null and "vehicles"."vehicle_encumbrances"."release_requested_at" is not null
                            and "vehicles"."vehicle_encumbrances"."released_by" is not null and "vehicles"."vehicle_encumbrances"."released_at" is not null
                            and "vehicles"."vehicle_encumbrances"."released_by" <> "vehicles"."vehicle_encumbrances"."release_requested_by" and "vehicles"."vehicle_encumbrances"."release_refusal_reason" is null)),
	CONSTRAINT "vehicle_encumbrances_dates_check" CHECK ("vehicles"."vehicle_encumbrances"."release_date" is null or "vehicles"."vehicle_encumbrances"."release_date" >= "vehicles"."vehicle_encumbrances"."letter_date")
);
--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_encumbrances" ADD CONSTRAINT "vehicle_encumbrances_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_encumbrances" ADD CONSTRAINT "vehicle_encumbrances_recorded_unit_id_org_units_id_fk" FOREIGN KEY ("recorded_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_encumbrances_letter_uq" ON "vehicles"."vehicle_encumbrances" USING btree ("vehicle_id","kind","holder_organisation_id","letter_reference");--> statement-breakpoint
CREATE INDEX "vehicle_encumbrances_vehicle_idx" ON "vehicles"."vehicle_encumbrances" USING btree ("vehicle_id") WHERE "vehicles"."vehicle_encumbrances"."status" <> 'released';--> statement-breakpoint
CREATE INDEX "vehicle_encumbrances_region_status_idx" ON "vehicles"."vehicle_encumbrances" USING btree ("region_id","status");--> statement-breakpoint
CREATE INDEX "vehicle_encumbrances_recorded_gist" ON "vehicles"."vehicle_encumbrances" USING gist ("recorded_org_path");
--> statement-breakpoint
-- The hand-written part (task 1.4a): a bank and a court are kinds of organisation (the holder of a hold is a parties.organisations
-- row); the holder and the stored letters; the vehicle's region copied onto the hold (a hold cannot name a vehicle outside the
-- caller's region: the vehicle is invisible to it); the recording unit's path; the machine of a hold as a trigger (a released
-- hold is final, and what the letter said never changes, whoever writes); the grants (nothing is deleted, only the columns the
-- release moves through change); the class: registry at the recording office (the region reads, its line writes).
ALTER TABLE "parties"."organisations" DROP CONSTRAINT "organisations_kind_check";
--> statement-breakpoint
ALTER TABLE "parties"."organisations"
    ADD CONSTRAINT "organisations_kind_check" CHECK ("kind" IN ('association', 'training_school', 'contractor',
        'consultant', 'garage', 'insurer', 'health_facility', 'government_office', 'bank', 'court', 'other'));
--> statement-breakpoint
ALTER TABLE "vehicles"."vehicle_encumbrances"
    ADD CONSTRAINT "vehicle_encumbrances_holder_fk" FOREIGN KEY ("holder_organisation_id") REFERENCES "parties"."organisations"("id"),
    ADD CONSTRAINT "vehicle_encumbrances_letter_file_fk" FOREIGN KEY ("letter_file_id") REFERENCES "kernel"."files"("id"),
    ADD CONSTRAINT "vehicle_encumbrances_release_file_fk" FOREIGN KEY ("release_file_id") REFERENCES "kernel"."files"("id");
--> statement-breakpoint
CREATE FUNCTION "vehicles"."inherit_vehicle_region"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    parent_region uuid;
BEGIN
    SELECT v.region_id INTO parent_region FROM vehicles.vehicles v WHERE v.id = NEW.vehicle_id;
    IF parent_region IS NULL THEN
        RAISE EXCEPTION 'vehicles: the vehicle is not found' USING ERRCODE = 'foreign_key_violation';
    END IF;
    NEW.region_id := parent_region;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
-- the trigger name sorts before set_org_path, so the recording unit's region is checked against the vehicle's
CREATE TRIGGER "inherit_vehicle_region" BEFORE INSERT ON "vehicles"."vehicle_encumbrances"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."inherit_vehicle_region"();
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "vehicles"."vehicle_encumbrances"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('recorded_unit_id', 'recorded_org_path');
--> statement-breakpoint
-- The machine of contracts/encumbrances.ts: a hold is recorded open; a release is requested (open to release_pending), then
-- confirmed (to released, final) or refused (back to open).
CREATE FUNCTION "vehicles"."check_encumbrance_transition"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    ok boolean;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'open' THEN
            RAISE EXCEPTION 'vehicles: an encumbrance is recorded open'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'encumbrance_transition';
        END IF;
        RETURN NEW;
    END IF;
    ok := OLD.status <> 'released'
        AND NEW.vehicle_id = OLD.vehicle_id AND NEW.kind = OLD.kind
        AND NEW.holder_organisation_id = OLD.holder_organisation_id
        AND NEW.letter_reference = OLD.letter_reference AND NEW.letter_date = OLD.letter_date
        AND NEW.recorded_unit_id = OLD.recorded_unit_id
        AND CASE
            WHEN OLD.status = 'open' THEN NEW.status IN ('open', 'release_pending')
            WHEN OLD.status = 'release_pending' THEN NEW.status IN ('open', 'released')
            ELSE false
        END;
    IF NOT ok THEN
        RAISE EXCEPTION 'vehicles: encumbrance % cannot go from % to %', OLD.id, OLD.status, NEW.status
            USING ERRCODE = 'check_violation', CONSTRAINT = 'encumbrance_transition';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
-- not on the scope column: an org-unit move rewrites every row's recorded_org_path, and a released hold must survive it
CREATE TRIGGER "encumbrance_transition" BEFORE INSERT OR UPDATE OF "vehicle_id", "recorded_unit_id", "kind",
    "holder_organisation_id", "letter_reference", "letter_date", "status" ON "vehicles"."vehicle_encumbrances"
    FOR EACH ROW EXECUTE FUNCTION "vehicles"."check_encumbrance_transition"();
--> statement-breakpoint
GRANT SELECT, INSERT ON "vehicles"."vehicle_encumbrances" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "release_reference", "release_date", "release_file_id", "release_note", "release_requested_by",
    "release_requested_at", "released_by", "released_at", "release_refusal_reason", "updated_at", "updated_by", "row_version")
    ON "vehicles"."vehicle_encumbrances" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('vehicles.vehicle_encumbrances', 'registry', 'recorded_org_path');
