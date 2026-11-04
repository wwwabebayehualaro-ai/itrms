CREATE TABLE "fees"."external_payment_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"order_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"reference" text NOT NULL,
	"reference_norm" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"paid_on" date NOT NULL,
	"amount_santim" bigint NOT NULL,
	"received_from" text NOT NULL,
	"state" text DEFAULT 'pending_verification' NOT NULL,
	"entered_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"verified_via" text,
	"note" text,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "fees"."external_statement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"statement_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"issuer" text NOT NULL,
	"reference" text,
	"reference_norm" text,
	"fiscal_year" integer,
	"paid_on" date,
	"amount_santim" bigint,
	"state" text NOT NULL,
	"reason" text,
	"ref_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fees"."external_statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"issuer" text NOT NULL,
	"statement_date" date NOT NULL,
	"filename" text NOT NULL,
	"layout" text NOT NULL,
	"sha256" text NOT NULL,
	"content" text NOT NULL,
	"state" text DEFAULT 'received' NOT NULL,
	"failure" text,
	"imported_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fees"."payment_orders" ADD COLUMN "settled_external_ref_id" uuid;--> statement-breakpoint
ALTER TABLE "fees"."external_payment_refs" ADD CONSTRAINT "external_payment_refs_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."external_payment_refs" ADD CONSTRAINT "external_payment_refs_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "fees"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."external_statement_lines" ADD CONSTRAINT "external_statement_lines_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."external_statement_lines" ADD CONSTRAINT "external_statement_lines_statement_id_external_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "fees"."external_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."external_statement_lines" ADD CONSTRAINT "external_statement_lines_ref_id_external_payment_refs_id_fk" FOREIGN KEY ("ref_id") REFERENCES "fees"."external_payment_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."external_statements" ADD CONSTRAINT "external_statements_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_payment_refs_key_uq" ON "fees"."external_payment_refs" USING btree ("region_id","issuer","reference_norm","fiscal_year") WHERE state IN ('pending_verification', 'verified');--> statement-breakpoint
CREATE UNIQUE INDEX "external_payment_refs_order_live_uq" ON "fees"."external_payment_refs" USING btree ("order_id") WHERE state IN ('pending_verification', 'verified');--> statement-breakpoint
CREATE INDEX "external_payment_refs_inbox_idx" ON "fees"."external_payment_refs" USING btree ("state","id");--> statement-breakpoint
CREATE INDEX "external_payment_refs_key_idx" ON "fees"."external_payment_refs" USING btree ("region_id","issuer","reference_norm","fiscal_year");--> statement-breakpoint
CREATE INDEX "external_payment_refs_org_path_gist" ON "fees"."external_payment_refs" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "external_statement_lines_no_uq" ON "fees"."external_statement_lines" USING btree ("statement_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "external_statement_lines_key_uq" ON "fees"."external_statement_lines" USING btree ("region_id","issuer","reference_norm","fiscal_year") WHERE state NOT IN ('duplicate', 'invalid');--> statement-breakpoint
CREATE INDEX "external_statement_lines_ref_idx" ON "fees"."external_statement_lines" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX "external_statement_lines_org_path_gist" ON "fees"."external_statement_lines" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "external_statements_file_uq" ON "fees"."external_statements" USING btree ("region_id","issuer","sha256");--> statement-breakpoint
CREATE INDEX "external_statements_list_idx" ON "fees"."external_statements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "external_statements_org_path_gist" ON "fees"."external_statements" USING gist ("org_path");--> statement-breakpoint
-- Hand-written (task 0.22c, ADR-0043): references of money paid elsewhere and the statements that verify them, class T at
-- the handling unit. Scope triggers, checks, an order settled by a reference of its own, the state rules (a reference moves
-- forward once, a statement's file never changes), the region-wide checks a request can't see past RLS, grants, RLS.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."external_payment_refs"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."external_statements"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."external_statement_lines"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
ALTER TABLE "fees"."external_payment_refs"
    ADD CONSTRAINT "external_payment_refs_state_check" CHECK (
        "state" IN ('pending_verification', 'verified', 'rejected', 'revoked', 'withdrawn')),
    ADD CONSTRAINT "external_payment_refs_amount_check" CHECK ("amount_santim" > 0),
    ADD CONSTRAINT "external_payment_refs_issuer_check" CHECK ("issuer" ~ '^[A-Z0-9]{2,12}$'),
    ADD CONSTRAINT "external_payment_refs_reference_check" CHECK (
        length("reference") BETWEEN 1 AND 40 AND length("reference_norm") >= 1),
    ADD CONSTRAINT "external_payment_refs_received_from_check" CHECK (length("received_from") BETWEEN 2 AND 200),
    ADD CONSTRAINT "external_payment_refs_note_check" CHECK ("note" IS NULL OR length("note") <= 500),
    -- verified by a person who is named, or by a statement's line with nobody; rejected by a person who says why
    ADD CONSTRAINT "external_payment_refs_decided_check" CHECK (
        ("state" IN ('pending_verification', 'withdrawn') AND "decided_at" IS NULL AND "decided_by" IS NULL
            AND "verified_via" IS NULL)
        OR ("state" = 'rejected' AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL AND "verified_via" IS NULL
            AND "note" IS NOT NULL)
        OR ("state" IN ('verified', 'revoked') AND "decided_at" IS NOT NULL AND (
            ("verified_via" = 'person' AND "decided_by" IS NOT NULL)
            OR ("verified_via" = 'statement' AND "decided_by" IS NULL)))),
    ADD CONSTRAINT "external_payment_refs_revoked_check" CHECK (
        ("state" = 'revoked') = ("revoked_by" IS NOT NULL)
        AND ("revoked_by" IS NULL) = ("revoked_at" IS NULL)
        AND ("revoked_by" IS NULL) = ("revoke_reason" IS NULL)
        AND ("revoke_reason" IS NULL OR length("revoke_reason") BETWEEN 10 AND 500)),
    -- separation of duties: never the person who entered it, and a revocation is by a third person
    ADD CONSTRAINT "external_payment_refs_sod_check" CHECK (
        ("decided_by" IS NULL OR "decided_by" <> "entered_by")
        AND ("revoked_by" IS NULL OR ("revoked_by" <> "entered_by"
            AND ("decided_by" IS NULL OR "revoked_by" <> "decided_by")))),
    ADD CONSTRAINT "external_payment_refs_id_order_uq" UNIQUE ("id", "order_id"),
    ADD CONSTRAINT "external_payment_refs_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases" ("id");
--> statement-breakpoint
ALTER TABLE "fees"."payment_orders" DROP CONSTRAINT "payment_orders_settled_check";
--> statement-breakpoint
ALTER TABLE "fees"."payment_orders"
    -- settled by a payment at the till or a verified reference: one of them, and only when settled
    ADD CONSTRAINT "payment_orders_settled_check" CHECK (
        ("state" = 'settled') = (num_nonnulls("settled_payment_id", "settled_external_ref_id") = 1)
        AND num_nonnulls("settled_payment_id", "settled_external_ref_id") <= 1),
    ADD CONSTRAINT "payment_orders_settled_ref_fk" FOREIGN KEY ("settled_external_ref_id", "id")
        REFERENCES "fees"."external_payment_refs" ("id", "order_id");
--> statement-breakpoint
ALTER TABLE "fees"."external_statements"
    ADD CONSTRAINT "external_statements_state_check" CHECK ("state" IN ('received', 'matching', 'processed', 'failed')),
    ADD CONSTRAINT "external_statements_failed_check" CHECK (("state" = 'failed') = ("failure" IS NOT NULL)),
    ADD CONSTRAINT "external_statements_issuer_check" CHECK ("issuer" ~ '^[A-Z0-9]{2,12}$'),
    ADD CONSTRAINT "external_statements_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "external_statements_filename_check" CHECK (length("filename") BETWEEN 1 AND 200),
    ADD CONSTRAINT "external_statements_content_check" CHECK (octet_length("content") <= 1048576);
--> statement-breakpoint
ALTER TABLE "fees"."external_statement_lines"
    ADD CONSTRAINT "external_statement_lines_state_check" CHECK (
        "state" IN ('unmatched', 'matched', 'amount_mismatch', 'held', 'duplicate', 'invalid')),
    ADD CONSTRAINT "external_statement_lines_amount_check" CHECK ("amount_santim" IS NULL OR "amount_santim" > 0),
    ADD CONSTRAINT "external_statement_lines_no_check" CHECK ("line_no" >= 1),
    -- only an unreadable line lacks what matching reads
    ADD CONSTRAINT "external_statement_lines_complete_check" CHECK (
        "state" = 'invalid' OR ("reference_norm" IS NOT NULL AND "fiscal_year" IS NOT NULL AND "paid_on" IS NOT NULL
            AND "amount_santim" IS NOT NULL));
--> statement-breakpoint
-- A reference moves forward once: pending → verified, rejected or withdrawn; verified → revoked. What it says never changes.
CREATE FUNCTION "fees"."external_ref_forward"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    moving constant text[] := ARRAY['org_path', 'state', 'decided_by', 'decided_at', 'verified_via', 'note', 'revoked_by',
        'revoked_at', 'revoke_reason', 'updated_at', 'updated_by', 'row_version'];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF (to_jsonb(NEW) - moving) = (to_jsonb(OLD) - moving)
           AND ((OLD.state = 'pending_verification' AND NEW.state IN ('verified', 'rejected', 'withdrawn'))
                OR (OLD.state = 'verified' AND NEW.state = 'revoked')) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'fees.external_payment_refs moves forward once: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "external_payment_refs_forward" BEFORE UPDATE OR DELETE ON "fees"."external_payment_refs"
    FOR EACH ROW EXECUTE FUNCTION "fees"."external_ref_forward"();
--> statement-breakpoint
CREATE TRIGGER "external_payment_refs_no_truncate" BEFORE TRUNCATE ON "fees"."external_payment_refs"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
-- A statement is its file: only how far the worker got changes. A line is what the file said: only its verdict changes.
CREATE FUNCTION "fees"."statement_as_filed"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    moving constant text[] := ARRAY['org_path', 'state', 'failure', 'reason', 'ref_id', 'updated_at', 'updated_by',
        'row_version'];
BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - moving) = (to_jsonb(OLD) - moving) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION '% keeps what the file said: % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "external_statements_as_filed" BEFORE UPDATE OR DELETE ON "fees"."external_statements"
    FOR EACH ROW EXECUTE FUNCTION "fees"."statement_as_filed"();
--> statement-breakpoint
CREATE TRIGGER "external_statements_no_truncate" BEFORE TRUNCATE ON "fees"."external_statements"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "external_statement_lines_as_filed" BEFORE UPDATE OR DELETE ON "fees"."external_statement_lines"
    FOR EACH ROW EXECUTE FUNCTION "fees"."statement_as_filed"();
--> statement-breakpoint
CREATE TRIGGER "external_statement_lines_no_truncate" BEFORE TRUNCATE ON "fees"."external_statement_lines"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
-- One deposit can't pay twice, at a till as a slip and elsewhere as a reference. Another office's rows are past the request's
-- RLS, so these two narrow functions answer yes or no for the caller's region, and only that. Each takes a lock on the
-- reference until the transaction ends, so the two ways can't both pass at the same moment. A reference is compared
-- without leading zeros; the lock order is the case, the order, this lock, then the counter (ADR-0042).
CREATE FUNCTION "fees"."slip_in_use"(p_bank text, p_norm text) RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_region constant uuid := nullif(current_setting('app.region_id', true), '')::uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_region::text || '|' || p_bank || '|' || p_norm, 0));
    RETURN EXISTS (
        SELECT 1 FROM fees.payments p
         WHERE p.region_id = v_region AND p.method = 'bank_slip' AND p.voided_at IS NULL
           AND p.bank_code = p_bank AND ltrim(p.slip_reference_norm, '0') = ltrim(p_norm, '0'));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "fees"."external_reference_in_use"(p_issuer text, p_norm text) RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_region constant uuid := nullif(current_setting('app.region_id', true), '')::uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_region::text || '|' || p_issuer || '|' || p_norm, 0));
    RETURN EXISTS (
        SELECT 1 FROM fees.external_payment_refs r
         WHERE r.region_id = v_region AND r.state IN ('pending_verification', 'verified')
           AND r.issuer = p_issuer AND ltrim(r.reference_norm, '0') = ltrim(p_norm, '0'));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "fees"."slip_in_use"(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "fees"."external_reference_in_use"(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "fees"."slip_in_use"(text, text) TO itrms_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "fees"."external_reference_in_use"(text, text) TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fees"."external_payment_refs", "fees"."external_statements" TO itrms_app;
--> statement-breakpoint
GRANT SELECT ON "fees"."external_statement_lines" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "decided_by", "decided_at", "verified_via", "note", "revoked_by", "revoked_at", "revoke_reason",
    "updated_at", "updated_by", "row_version") ON "fees"."external_payment_refs" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("settled_external_ref_id") ON "fees"."payment_orders" TO itrms_app;
--> statement-breakpoint
-- a revocation frees the line its reference matched
GRANT UPDATE ("state", "reason", "ref_id", "updated_at", "updated_by", "row_version")
    ON "fees"."external_statement_lines" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('fees.external_payment_refs', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.external_statements', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.external_statement_lines', 'transaction', 'org_path');
