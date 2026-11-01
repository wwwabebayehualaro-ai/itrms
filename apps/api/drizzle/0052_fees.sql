CREATE SCHEMA "fees";
--> statement-breakpoint
CREATE TABLE "fees"."case_fee_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"case_fee_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"key" text NOT NULL,
	"label" jsonb NOT NULL,
	"quantity" integer,
	"amount_santim" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fees"."case_fees" (
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
	"number" integer NOT NULL,
	"reason" text NOT NULL,
	"fee_rule_version_id" uuid NOT NULL,
	"input_map" jsonb NOT NULL,
	"as_of" date NOT NULL,
	"submission_id" uuid,
	"total_santim" bigint NOT NULL,
	"demo" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fees"."fee_rule_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"version_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"decided_by" uuid
);
--> statement-breakpoint
CREATE TABLE "fees"."fee_rule_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"rule_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"document" jsonb NOT NULL,
	"demo" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fees"."fee_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"latest_version_id" uuid
);
--> statement-breakpoint
ALTER TABLE "fees"."case_fee_lines" ADD CONSTRAINT "case_fee_lines_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."case_fee_lines" ADD CONSTRAINT "case_fee_lines_case_fee_id_case_fees_id_fk" FOREIGN KEY ("case_fee_id") REFERENCES "fees"."case_fees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."case_fees" ADD CONSTRAINT "case_fees_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."case_fees" ADD CONSTRAINT "case_fees_fee_rule_version_id_fee_rule_versions_id_fk" FOREIGN KEY ("fee_rule_version_id") REFERENCES "fees"."fee_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."fee_rule_approvals" ADD CONSTRAINT "fee_rule_approvals_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."fee_rule_approvals" ADD CONSTRAINT "fee_rule_approvals_version_id_fee_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "fees"."fee_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."fee_rule_versions" ADD CONSTRAINT "fee_rule_versions_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."fee_rule_versions" ADD CONSTRAINT "fee_rule_versions_rule_id_fee_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "fees"."fee_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."fee_rules" ADD CONSTRAINT "fee_rules_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."fee_rules" ADD CONSTRAINT "fee_rules_latest_version_id_fee_rule_versions_id_fk" FOREIGN KEY ("latest_version_id") REFERENCES "fees"."fee_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_fee_lines_position_uq" ON "fees"."case_fee_lines" USING btree ("case_fee_id","position");--> statement-breakpoint
CREATE INDEX "case_fee_lines_org_path_gist" ON "fees"."case_fee_lines" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "case_fees_number_uq" ON "fees"."case_fees" USING btree ("case_id","number");--> statement-breakpoint
CREATE INDEX "case_fees_org_path_gist" ON "fees"."case_fees" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_rule_approvals_version_uq" ON "fees"."fee_rule_approvals" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "fee_rule_approvals_org_path_gist" ON "fees"."fee_rule_approvals" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_rule_versions_content_uq" ON "fees"."fee_rule_versions" USING btree ("rule_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_rule_versions_number_uq" ON "fees"."fee_rule_versions" USING btree ("rule_id","number");--> statement-breakpoint
CREATE INDEX "fee_rule_versions_org_path_gist" ON "fees"."fee_rule_versions" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_rules_key_uq" ON "fees"."fee_rules" USING btree ("region_id","key");--> statement-breakpoint
CREATE INDEX "fee_rules_org_path_gist" ON "fees"."fee_rules" USING gist ("org_path");--> statement-breakpoint
-- Hand-written (task 0.22a, ADR-0041): fee rules owned at the region's root (class C) with immutable, approved versions,
-- and the fees cases keep (class T at the handling unit), append-only. Scope triggers, checks, the keys to other slices'
-- tables, grants and RLS.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."fee_rules"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."fee_rule_versions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."fee_rule_approvals"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."case_fees"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."case_fee_lines"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
ALTER TABLE "fees"."fee_rules"
    ADD CONSTRAINT "fee_rules_key_check" CHECK ("key" ~ '^[a-z][a-z0-9-]{1,62}$'),
    ADD CONSTRAINT "fee_rules_name_check" CHECK (
        jsonb_typeof("name") = 'object' AND "name" ? 'am' AND "name" ? 'en' AND pg_column_size("name") <= 4096);
--> statement-breakpoint
ALTER TABLE "fees"."fee_rule_versions"
    ADD CONSTRAINT "fee_rule_versions_number_check" CHECK ("number" >= 1),
    ADD CONSTRAINT "fee_rule_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "fee_rule_versions_document_check" CHECK (
        jsonb_typeof("document") = 'object' AND pg_column_size("document") <= 262144),
    -- the target of the key below: a version is named together with its rule
    ADD CONSTRAINT "fee_rule_versions_rule_uq" UNIQUE ("id", "rule_id");
--> statement-breakpoint
-- a rule's latest version is one of its own
ALTER TABLE "fees"."fee_rules"
    ADD CONSTRAINT "fee_rules_latest_version_fk" FOREIGN KEY ("latest_version_id", "id")
        REFERENCES "fees"."fee_rule_versions" ("id", "rule_id");
--> statement-breakpoint
ALTER TABLE "fees"."fee_rule_approvals"
    ADD CONSTRAINT "fee_rule_approvals_decision_check" CHECK ("decision" IN ('approved', 'rejected')),
    ADD CONSTRAINT "fee_rule_approvals_reason_check" CHECK ("reason" IS NULL OR length("reason") <= 500);
--> statement-breakpoint
ALTER TABLE "fees"."case_fees"
    ADD CONSTRAINT "case_fees_number_check" CHECK ("number" >= 1),
    ADD CONSTRAINT "case_fees_reason_check" CHECK ("reason" IN ('filed', 'amended') AND ("number" = 1) = ("reason" = 'filed')),
    ADD CONSTRAINT "case_fees_total_check" CHECK ("total_santim" >= 0),
    ADD CONSTRAINT "case_fees_input_map_check" CHECK (
        jsonb_typeof("input_map") = 'object' AND pg_column_size("input_map") <= 16384),
    ADD CONSTRAINT "case_fees_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases" ("id"),
    ADD CONSTRAINT "case_fees_submission_fk" FOREIGN KEY ("submission_id") REFERENCES "forms"."submissions" ("id");
--> statement-breakpoint
ALTER TABLE "fees"."case_fee_lines"
    ADD CONSTRAINT "case_fee_lines_position_check" CHECK ("position" >= 1),
    ADD CONSTRAINT "case_fee_lines_amount_check" CHECK ("amount_santim" > 0),
    ADD CONSTRAINT "case_fee_lines_quantity_check" CHECK ("quantity" IS NULL OR "quantity" >= 0),
    ADD CONSTRAINT "case_fee_lines_label_check" CHECK (jsonb_typeof("label") = 'object' AND pg_column_size("label") <= 4096);
--> statement-breakpoint
CREATE INDEX "case_fees_case_idx" ON "fees"."case_fees" ("case_id");
--> statement-breakpoint
-- a service version names the fee rule version it charges by (task 0.21b left the column for this task)
ALTER TABLE "services"."service_versions"
    ADD CONSTRAINT "service_versions_fee_rule_version_fk" FOREIGN KEY ("fee_rule_version_id")
        REFERENCES "fees"."fee_rule_versions" ("id");
--> statement-breakpoint
-- Versions, decisions and a case's fees never change and are never removed, for any role, the owner included: only a
-- unit move may rewrite their org_path (kernel.org_units_move_subtree, through the set_org_path trigger).
CREATE FUNCTION "fees"."append_only"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "fee_rule_versions_append_only" BEFORE UPDATE OR DELETE ON "fees"."fee_rule_versions"
    FOR EACH ROW EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "fee_rule_versions_no_truncate" BEFORE TRUNCATE ON "fees"."fee_rule_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "fee_rule_approvals_append_only" BEFORE UPDATE OR DELETE ON "fees"."fee_rule_approvals"
    FOR EACH ROW EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "fee_rule_approvals_no_truncate" BEFORE TRUNCATE ON "fees"."fee_rule_approvals"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "case_fees_append_only" BEFORE UPDATE OR DELETE ON "fees"."case_fees"
    FOR EACH ROW EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "case_fees_no_truncate" BEFORE TRUNCATE ON "fees"."case_fees"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "case_fee_lines_append_only" BEFORE UPDATE OR DELETE ON "fees"."case_fee_lines"
    FOR EACH ROW EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "case_fee_lines_no_truncate" BEFORE TRUNCATE ON "fees"."case_fee_lines"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
GRANT USAGE ON SCHEMA "fees" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fees"."fee_rules", "fees"."fee_rule_versions", "fees"."fee_rule_approvals",
    "fees"."case_fees", "fees"."case_fee_lines" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "active", "latest_version_id", "updated_at", "updated_by", "row_version")
    ON "fees"."fee_rules" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('fees.fee_rules', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.fee_rule_versions', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.fee_rule_approvals', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.case_fees', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.case_fee_lines', 'transaction', 'org_path');
