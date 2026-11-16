CREATE TABLE "competency"."campaign_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"campaign_id" uuid NOT NULL,
	"target" integer NOT NULL,
	"set_by_unit_id" uuid NOT NULL,
	CONSTRAINT "campaign_targets_check" CHECK (target BETWEEN 1 AND 10000000)
);
--> statement-breakpoint
CREATE TABLE "competency"."campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"name" jsonb NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "campaigns_dates_check" CHECK (ends_on >= starts_on AND ends_on - starts_on < 366)
);
--> statement-breakpoint
ALTER TABLE "competency"."campaign_targets" ADD CONSTRAINT "campaign_targets_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."campaign_targets" ADD CONSTRAINT "campaign_targets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "competency"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."campaign_targets" ADD CONSTRAINT "campaign_targets_set_by_unit_id_org_units_id_fk" FOREIGN KEY ("set_by_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."campaigns" ADD CONSTRAINT "campaigns_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_targets_uq" ON "competency"."campaign_targets" USING btree ("campaign_id","handling_unit_id");--> statement-breakpoint
CREATE INDEX "campaign_targets_org_path_gist" ON "competency"."campaign_targets" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "campaigns_unit_kind_idx" ON "competency"."campaigns" USING btree ("handling_unit_id","kind");--> statement-breakpoint
CREATE INDEX "campaigns_org_path_gist" ON "competency"."campaigns" USING gist ("org_path");
--> statement-breakpoint
-- The hand-written part (task 1.13i): the kinds a text column takes; an office never sets its own target (the service also requires
-- the setter to be above it); the units' paths; what the app may change (a campaign's name, last day and closing; a target's number
-- and who set it, never its office nor its campaign); the classes: a campaign is config (the running unit and the units above it write it, the
-- offices below read it), a target is transaction at the office (its subtree and the units above it).
ALTER TABLE "competency"."campaigns" ADD CONSTRAINT "campaigns_enums_check"
    CHECK ("kind" IN ('plate_exchange', 'bolo_season'));
--> statement-breakpoint
ALTER TABLE "competency"."campaign_targets" ADD CONSTRAINT "campaign_targets_setter_check"
    CHECK ("set_by_unit_id" <> "handling_unit_id");
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."campaigns"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."campaign_targets"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."campaigns" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "ends_on", "closed_at", "updated_at", "updated_by", "row_version")
    ON "competency"."campaigns" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."campaign_targets" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("target", "set_by_unit_id", "updated_at", "updated_by", "row_version")
    ON "competency"."campaign_targets" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.campaigns', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.campaign_targets', 'transaction', 'org_path');
