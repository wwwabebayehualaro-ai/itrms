CREATE TABLE "fees"."cashier_session_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt" smallint NOT NULL,
	"cashier_id" uuid NOT NULL,
	"counted_santim" bigint NOT NULL,
	"denominations" jsonb,
	"expected_santim" bigint NOT NULL,
	"difference_santim" bigint NOT NULL,
	"note" text,
	"counted_by" uuid NOT NULL,
	"state" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "cashier_session_counts_attempt_uq" UNIQUE("session_id","attempt"),
	CONSTRAINT "cashier_session_counts_id_session_uq" UNIQUE("id","session_id")
);
--> statement-breakpoint
CREATE TABLE "fees"."cashier_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"cashier_id" uuid NOT NULL,
	"business_day" date NOT NULL,
	"opening_float_santim" bigint DEFAULT 0 NOT NULL,
	"opened_via" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"till_closed_at" timestamp with time zone,
	"cash_receipts_santim" bigint,
	"bank_slip_santim" bigint,
	"receipt_count" integer,
	"expected_cash_santim" bigint,
	"closing_count_id" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "cashier_sessions_id_cashier_unit_uq" UNIQUE("id","cashier_id","handling_unit_id")
);
--> statement-breakpoint
ALTER TABLE "fees"."payments" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "fees"."receipt_reversals" ADD COLUMN "after_till_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fees"."cashier_session_counts" ADD CONSTRAINT "cashier_session_counts_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."cashier_session_counts" ADD CONSTRAINT "cashier_session_counts_session_id_cashier_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "fees"."cashier_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."cashier_sessions" ADD CONSTRAINT "cashier_sessions_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cashier_session_counts_pending_uq" ON "fees"."cashier_session_counts" USING btree ("session_id") WHERE state = 'pending';--> statement-breakpoint
CREATE INDEX "cashier_session_counts_inbox_idx" ON "fees"."cashier_session_counts" USING btree ("state","created_at") WHERE state = 'pending';--> statement-breakpoint
CREATE INDEX "cashier_session_counts_org_path_gist" ON "fees"."cashier_session_counts" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "cashier_sessions_open_uq" ON "fees"."cashier_sessions" USING btree ("handling_unit_id","cashier_id","business_day") WHERE state = 'open';--> statement-breakpoint
CREATE INDEX "cashier_sessions_unit_idx" ON "fees"."cashier_sessions" USING btree ("handling_unit_id","state","business_day");--> statement-breakpoint
CREATE INDEX "cashier_sessions_org_path_gist" ON "fees"."cashier_sessions" USING gist ("org_path");
--> statement-breakpoint
-- Hand-written (task 1.12, ADR-0063): cashier sessions and their counts, class T at the office. Scope triggers, checks, the
-- keys (a count and a payment belong to the session's own cashier and office), the allowed moves of a session and the
-- decision of a count (separation of duties), grants and RLS; a payment names an open session; a reversal decided after the
-- till was counted is marked.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."cashier_sessions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."cashier_session_counts"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
ALTER TABLE "fees"."cashier_sessions"
    ADD CONSTRAINT "cashier_sessions_state_check" CHECK ("state" IN ('open', 'pending_approval', 'counting', 'closed')),
    ADD CONSTRAINT "cashier_sessions_opened_via_check" CHECK ("opened_via" IN ('explicit', 'payment')),
    ADD CONSTRAINT "cashier_sessions_float_check" CHECK ("opening_float_santim" >= 0),
    -- what the first count freezes is set together, and only once the session is not open
    ADD CONSTRAINT "cashier_sessions_frozen_check" CHECK (
        ("state" = 'open') = ("till_closed_at" IS NULL)
        AND ("till_closed_at" IS NULL) = ("cash_receipts_santim" IS NULL)
        AND ("till_closed_at" IS NULL) = ("bank_slip_santim" IS NULL)
        AND ("till_closed_at" IS NULL) = ("receipt_count" IS NULL)
        AND ("till_closed_at" IS NULL) = ("expected_cash_santim" IS NULL)),
    ADD CONSTRAINT "cashier_sessions_figures_check" CHECK (
        "cash_receipts_santim" IS NULL
        OR ("cash_receipts_santim" >= 0 AND "bank_slip_santim" >= 0 AND "receipt_count" >= 0
            AND "expected_cash_santim" = "opening_float_santim" + "cash_receipts_santim")),
    ADD CONSTRAINT "cashier_sessions_closed_check" CHECK (
        ("state" = 'closed') = ("closing_count_id" IS NOT NULL) AND ("closing_count_id" IS NULL) = ("closed_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "fees"."cashier_session_counts"
    ADD CONSTRAINT "cashier_session_counts_state_check" CHECK ("state" IN ('balanced', 'pending', 'approved', 'rejected')),
    ADD CONSTRAINT "cashier_session_counts_attempt_check" CHECK ("attempt" >= 1),
    ADD CONSTRAINT "cashier_session_counts_amounts_check" CHECK ("counted_santim" >= 0 AND "expected_santim" >= 0),
    ADD CONSTRAINT "cashier_session_counts_difference_check" CHECK (
        "difference_santim" = "counted_santim" - "expected_santim"
        AND ("difference_santim" = 0) = ("state" = 'balanced')),
    -- a difference is explained
    ADD CONSTRAINT "cashier_session_counts_note_check" CHECK (
        coalesce(length("note"), 0) <= 500
        AND ("difference_santim" = 0 OR ("note" IS NOT NULL AND length("note") >= 10))),
    ADD CONSTRAINT "cashier_session_counts_denominations_check" CHECK (
        "denominations" IS NULL OR (jsonb_typeof("denominations") = 'array' AND pg_column_size("denominations") <= 4096)),
    -- the cashier counts their own till
    ADD CONSTRAINT "cashier_session_counts_counter_check" CHECK ("counted_by" = "cashier_id"),
    ADD CONSTRAINT "cashier_session_counts_decided_check" CHECK (
        ("state" IN ('approved', 'rejected')) = ("decided_by" IS NOT NULL) AND ("decided_by" IS NULL) = ("decided_at" IS NULL)),
    -- separation of duties (roles-and-permissions.md): never the cashier who counted
    ADD CONSTRAINT "cashier_session_counts_sod_check" CHECK (
        "decided_by" IS NULL OR ("decided_by" <> "cashier_id" AND "decided_by" <> "counted_by")),
    ADD CONSTRAINT "cashier_session_counts_decision_note_check" CHECK (
        coalesce(length("decision_note"), 0) <= 500
        AND ("state" <> 'rejected' OR ("decision_note" IS NOT NULL AND length("decision_note") >= 3)));
--> statement-breakpoint
-- a count belongs to its session's cashier and office; a session is closed by one of its own counts
ALTER TABLE "fees"."cashier_session_counts"
    ADD CONSTRAINT "cashier_session_counts_session_owner_fk" FOREIGN KEY ("session_id", "cashier_id", "handling_unit_id")
        REFERENCES "fees"."cashier_sessions" ("id", "cashier_id", "handling_unit_id");
--> statement-breakpoint
ALTER TABLE "fees"."cashier_sessions"
    ADD CONSTRAINT "cashier_sessions_closing_count_fk" FOREIGN KEY ("closing_count_id", "id")
        REFERENCES "fees"."cashier_session_counts" ("id", "session_id");
--> statement-breakpoint
-- a payment is taken in its own cashier's session at its own office
ALTER TABLE "fees"."payments"
    ADD CONSTRAINT "payments_session_fk" FOREIGN KEY ("session_id", "received_by", "handling_unit_id")
        REFERENCES "fees"."cashier_sessions" ("id", "cashier_id", "handling_unit_id");
--> statement-breakpoint
CREATE INDEX "payments_session_idx" ON "fees"."payments" ("session_id") WHERE "session_id" IS NOT NULL;
--> statement-breakpoint
-- A session moves open → pending_approval or closed, pending_approval → closed or counting, counting → pending_approval or
-- closed; closed is final. What the first count froze never changes, nor who and where; a closed session is closed by one of
-- its own counts that balanced or was approved. Rows are never removed.
CREATE FUNCTION "fees"."session_transition"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    named text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF OLD.state = 'closed' THEN
            RAISE EXCEPTION 'fees.cashier_sessions: a closed session never changes' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF (to_jsonb(NEW) - ARRAY['org_path', 'state', 'till_closed_at', 'cash_receipts_santim', 'bank_slip_santim',
                'receipt_count', 'expected_cash_santim', 'closing_count_id', 'closed_at', 'updated_at', 'updated_by',
                'row_version']) <> (to_jsonb(OLD) - ARRAY['org_path', 'state', 'till_closed_at', 'cash_receipts_santim',
                'bank_slip_santim', 'receipt_count', 'expected_cash_santim', 'closing_count_id', 'closed_at', 'updated_at',
                'updated_by', 'row_version']) THEN
            RAISE EXCEPTION 'fees.cashier_sessions: only its state and what the count froze change'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF OLD.till_closed_at IS NOT NULL AND (NEW.till_closed_at, NEW.cash_receipts_santim, NEW.bank_slip_santim,
                NEW.receipt_count, NEW.expected_cash_santim) IS DISTINCT FROM (OLD.till_closed_at, OLD.cash_receipts_santim,
                OLD.bank_slip_santim, OLD.receipt_count, OLD.expected_cash_santim) THEN
            RAISE EXCEPTION 'fees.cashier_sessions: what the first count froze is set once'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NOT (
            (OLD.state = 'open' AND NEW.state IN ('open', 'pending_approval', 'closed'))
            OR (OLD.state = 'pending_approval' AND NEW.state IN ('pending_approval', 'closed', 'counting'))
            OR (OLD.state = 'counting' AND NEW.state IN ('counting', 'pending_approval', 'closed'))
        ) THEN
            RAISE EXCEPTION 'fees.cashier_sessions: % to % is not allowed', OLD.state, NEW.state
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NEW.state = 'closed' THEN
            SELECT c.state INTO named FROM fees.cashier_session_counts c WHERE c.id = NEW.closing_count_id;
            IF named IS NULL OR named NOT IN ('balanced', 'approved') THEN
                RAISE EXCEPTION 'fees.cashier_sessions: a session is closed by a balanced or an approved count'
                    USING ERRCODE = 'insufficient_privilege';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'fees.cashier_sessions: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cashier_sessions_transition" BEFORE UPDATE OR DELETE ON "fees"."cashier_sessions"
    FOR EACH ROW EXECUTE FUNCTION "fees"."session_transition"();
--> statement-breakpoint
CREATE TRIGGER "cashier_sessions_no_truncate" BEFORE TRUNCATE ON "fees"."cashier_sessions"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
-- A count is decided once: pending → approved or rejected, and never changes after.
CREATE FUNCTION "fees"."count_decided_once"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF OLD.state = 'pending' AND NEW.state IN ('approved', 'rejected')
           AND (to_jsonb(NEW) - ARRAY['org_path', 'state', 'decided_by', 'decided_at', 'decision_note', 'updated_at',
                'updated_by', 'row_version']) = (to_jsonb(OLD) - ARRAY['org_path', 'state', 'decided_by', 'decided_at',
                'decision_note', 'updated_at', 'updated_by', 'row_version']) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'fees.cashier_session_counts is decided once: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cashier_session_counts_decided_once" BEFORE UPDATE OR DELETE ON "fees"."cashier_session_counts"
    FOR EACH ROW EXECUTE FUNCTION "fees"."count_decided_once"();
--> statement-breakpoint
CREATE TRIGGER "cashier_session_counts_no_truncate" BEFORE TRUNCATE ON "fees"."cashier_session_counts"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
-- A count is made while its session is open or being counted again.
CREATE FUNCTION "fees"."count_session_state"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    now_state text;
BEGIN
    SELECT s.state INTO now_state FROM fees.cashier_sessions s WHERE s.id = NEW.session_id;
    IF now_state IS NULL OR now_state NOT IN ('open', 'counting') OR NEW.state NOT IN ('balanced', 'pending') THEN
        RAISE EXCEPTION 'fees.cashier_session_counts: a count is made while the session is open or counted again'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'cashier_session_counts_session_state';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cashier_session_counts_session_state" BEFORE INSERT ON "fees"."cashier_session_counts"
    FOR EACH ROW EXECUTE FUNCTION "fees"."count_session_state"();
--> statement-breakpoint
-- A payment names a session that is open when it is taken. Payments made before the sessions keep none (the column stays
-- null for them); the column is frozen with the rest of the row by void_once.
CREATE FUNCTION "fees"."payment_session_required"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    now_state text;
BEGIN
    SELECT s.state INTO now_state FROM fees.cashier_sessions s WHERE s.id = NEW.session_id;
    IF now_state IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'fees.payments: a payment is taken in an open cashier session'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_session_required';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payments_session_required" BEFORE INSERT ON "fees"."payments"
    FOR EACH ROW EXECUTE FUNCTION "fees"."payment_session_required"();
--> statement-breakpoint
-- A reversal is decided once; the decision also says whether the payment's till had been counted (ADR-0063).
CREATE OR REPLACE FUNCTION "fees"."decided_once"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF OLD.state = 'requested' AND NEW.state IN ('approved', 'rejected')
           AND (to_jsonb(NEW) - ARRAY['org_path', 'state', 'decided_by', 'decided_at', 'note', 'after_till_closed',
                'updated_at', 'updated_by', 'row_version']) = (to_jsonb(OLD) - ARRAY['org_path', 'state', 'decided_by',
                'decided_at', 'note', 'after_till_closed', 'updated_at', 'updated_by', 'row_version']) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'fees.receipt_reversals is decided once: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
GRANT SELECT, INSERT ON "fees"."cashier_sessions", "fees"."cashier_session_counts" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "till_closed_at", "cash_receipts_santim", "bank_slip_santim", "receipt_count", "expected_cash_santim",
    "closing_count_id", "closed_at", "updated_at", "updated_by", "row_version") ON "fees"."cashier_sessions" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "decided_by", "decided_at", "decision_note", "updated_at", "updated_by", "row_version")
    ON "fees"."cashier_session_counts" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("after_till_closed") ON "fees"."receipt_reversals" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('fees.cashier_sessions', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.cashier_session_counts', 'transaction', 'org_path');
