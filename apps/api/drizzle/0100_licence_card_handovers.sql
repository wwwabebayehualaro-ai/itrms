CREATE TABLE "competency"."licence_card_handovers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"licence_id" uuid NOT NULL,
	"card_serial" text NOT NULL,
	"recipient" text NOT NULL,
	"id_kind" text NOT NULL,
	"id_number_ct" "bytea" NOT NULL,
	"representative_name_ct" "bytea",
	"handed_over_by" uuid NOT NULL,
	"handed_over_at" timestamp with time zone NOT NULL,
	CONSTRAINT "licence_card_handovers_recipient_check" CHECK (recipient in ('holder', 'representative')),
	CONSTRAINT "licence_card_handovers_id_kind_check" CHECK (id_kind in ('fayda', 'kebele_id', 'passport', 'driver_licence')),
	CONSTRAINT "licence_card_handovers_representative_check" CHECK ((recipient = 'representative') = (representative_name_ct IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "competency"."licence_card_handovers" ADD CONSTRAINT "licence_card_handovers_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_card_handovers" ADD CONSTRAINT "licence_card_handovers_licence_id_driver_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "competency"."driver_licences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "licence_card_handovers_card_uq" ON "competency"."licence_card_handovers" USING btree ("licence_id","card_serial");--> statement-breakpoint
CREATE INDEX "licence_card_handovers_org_path_gist" ON "competency"."licence_card_handovers" USING gist ("org_path");--> statement-breakpoint
-- Hand-written (task 1.6d, ADR-0064 §7). A licence's card handed over at its office: class T there (the offices above read it),
-- inserted once per card, never changed or deleted by the API. The recipient's ID number and a representative's name are
-- encrypted and bound to their row (FieldCrypto); the audit log omits them.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."licence_card_handovers"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."licence_card_handovers" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.licence_card_handovers', 'transaction', 'org_path');
