CREATE TABLE "fees"."remittance_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"remittance_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"receipt_id" uuid NOT NULL,
	"reversal_id" uuid,
	"order_line_position" integer NOT NULL,
	"line_key" text NOT NULL,
	"account_code" text NOT NULL,
	"budget_category" text NOT NULL,
	"account_name" jsonb NOT NULL,
	"mapped_by_default" boolean NOT NULL,
	"payment_method" text NOT NULL,
	"amount_santim" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fees"."remittance_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"remittance_id" uuid NOT NULL,
	"session_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fees"."remittances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"number" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"sequence" bigint NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"revenue_total_santim" bigint NOT NULL,
	"cash_santim" bigint NOT NULL,
	"bank_slip_santim" bigint NOT NULL,
	"reversal_santim" bigint NOT NULL,
	"difference_santim" bigint NOT NULL,
	"deposit_due_santim" bigint NOT NULL,
	"prepared_by" uuid NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deposit_bank" text,
	"deposit_reference" text,
	"deposit_reference_norm" text,
	"deposited_on" date,
	"deposited_amount_santim" bigint,
	"deposited_by" uuid,
	"deposited_at" timestamp with time zone,
	"demo" boolean NOT NULL,
	CONSTRAINT "remittances_id_unit_uq" UNIQUE("id","handling_unit_id")
);
--> statement-breakpoint
ALTER TABLE "fees"."remittance_lines" ADD CONSTRAINT "remittance_lines_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."remittance_lines" ADD CONSTRAINT "remittance_lines_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "fees"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."remittance_lines" ADD CONSTRAINT "remittance_lines_reversal_id_receipt_reversals_id_fk" FOREIGN KEY ("reversal_id") REFERENCES "fees"."receipt_reversals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."remittance_sessions" ADD CONSTRAINT "remittance_sessions_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."remittance_sessions" ADD CONSTRAINT "remittance_sessions_session_id_cashier_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "fees"."cashier_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."remittances" ADD CONSTRAINT "remittances_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "remittance_lines_receipt_uq" ON "fees"."remittance_lines" USING btree ("receipt_id","order_line_position") WHERE kind = 'receipt';--> statement-breakpoint
CREATE UNIQUE INDEX "remittance_lines_reversal_uq" ON "fees"."remittance_lines" USING btree ("reversal_id","order_line_position") WHERE kind = 'reversal';--> statement-breakpoint
CREATE INDEX "remittance_lines_remittance_idx" ON "fees"."remittance_lines" USING btree ("remittance_id");--> statement-breakpoint
CREATE INDEX "remittance_lines_org_path_gist" ON "fees"."remittance_lines" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "remittance_sessions_session_uq" ON "fees"."remittance_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "remittance_sessions_remittance_idx" ON "fees"."remittance_sessions" USING btree ("remittance_id");--> statement-breakpoint
CREATE INDEX "remittance_sessions_org_path_gist" ON "fees"."remittance_sessions" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "remittances_sequence_uq" ON "fees"."remittances" USING btree ("handling_unit_id","fiscal_year","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "remittances_number_uq" ON "fees"."remittances" USING btree ("handling_unit_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "remittances_deposit_reference_uq" ON "fees"."remittances" USING btree ("region_id","deposit_bank","deposit_reference_norm") WHERE deposit_reference_norm IS NOT NULL;--> statement-breakpoint
CREATE INDEX "remittances_unit_idx" ON "fees"."remittances" USING btree ("handling_unit_id","state","created_at");--> statement-breakpoint
CREATE INDEX "remittances_org_path_gist" ON "fees"."remittances" USING gist ("org_path");
--> statement-breakpoint
-- Hand-written (task 1.12d, ADR-0063 §5): the remittance, class T at the office. Scope triggers, checks, the keys (a part belongs to
-- its remittance's own office), the deposit that is recorded once, parts that are written with their remittance and never after, and
-- a deferred check that keeps the sums true at commit: the total is the receipts of the covered sessions less the reversals decided
-- after a till was counted; each receipt and each session is remitted at most once.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."remittances"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."remittance_sessions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."remittance_lines"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
ALTER TABLE "fees"."remittances"
    ADD CONSTRAINT "remittances_state_check" CHECK ("state" IN ('prepared', 'deposited', 'settled')),
    ADD CONSTRAINT "remittances_sequence_check" CHECK ("sequence" >= 1 AND "fiscal_year" >= 1),
    ADD CONSTRAINT "remittances_period_check" CHECK ("period_from" <= "period_to"),
    ADD CONSTRAINT "remittances_figures_check" CHECK (
        "cash_santim" >= 0 AND "bank_slip_santim" >= 0 AND "reversal_santim" <= 0
        AND "revenue_total_santim" = "cash_santim" + "bank_slip_santim" + "reversal_santim"),
    -- the deposit slip is recorded together, once, for the amount due
    ADD CONSTRAINT "remittances_deposit_check" CHECK (
        ("state" = 'deposited') = ("deposited_at" IS NOT NULL)
        AND ("deposited_at" IS NULL) = ("deposit_bank" IS NULL)
        AND ("deposited_at" IS NULL) = ("deposit_reference" IS NULL)
        AND ("deposited_at" IS NULL) = ("deposit_reference_norm" IS NULL)
        AND ("deposited_at" IS NULL) = ("deposited_on" IS NULL)
        AND ("deposited_at" IS NULL) = ("deposited_amount_santim" IS NULL)
        AND ("deposited_at" IS NULL) = ("deposited_by" IS NULL)
        AND ("deposited_amount_santim" IS NULL OR "deposited_amount_santim" = "deposit_due_santim")),
    -- nothing to deposit (only bank-slip money, counted equal to the floats) is settled at once, and only that is
    ADD CONSTRAINT "remittances_settled_check" CHECK (("state" = 'settled') = ("deposit_due_santim" = 0)),
    -- the slip is dated on or after the last day covered (not in the future: the trigger below)
    ADD CONSTRAINT "remittances_deposited_on_check" CHECK ("deposited_on" IS NULL OR "deposited_on" >= "period_to"),
    -- the bank is one of the payment slips' vocabulary; the reference as a slip's is compared (capitals, letters and digits, no
    -- leading zeros)
    ADD CONSTRAINT "remittances_deposit_bank_check" CHECK ("deposit_bank" IS NULL OR "deposit_bank" ~ '^[A-Z0-9]{2,12}$'),
    ADD CONSTRAINT "remittances_deposit_reference_check" CHECK (
        "deposit_reference_norm" IS NULL
        OR (length("deposit_reference_norm") BETWEEN 1 AND 40 AND position(' ' IN "deposit_reference_norm") = 0
            AND ("deposit_reference_norm" = '0' OR "deposit_reference_norm" NOT LIKE '0%')));
--> statement-breakpoint
ALTER TABLE "fees"."remittance_lines"
    ADD CONSTRAINT "remittance_lines_kind_check" CHECK ("kind" IN ('receipt', 'reversal')),
    ADD CONSTRAINT "remittance_lines_method_check" CHECK ("payment_method" IN ('cash', 'bank_slip')),
    ADD CONSTRAINT "remittance_lines_position_check" CHECK ("order_line_position" >= 1),
    -- a receipt's line is positive, a reversal's negative and names its reversal
    ADD CONSTRAINT "remittance_lines_amount_check" CHECK (
        ("kind" = 'receipt' AND "amount_santim" > 0 AND "reversal_id" IS NULL)
        OR ("kind" = 'reversal' AND "amount_santim" < 0 AND "reversal_id" IS NOT NULL));
--> statement-breakpoint
-- a part belongs to its remittance's own office
ALTER TABLE "fees"."remittance_sessions"
    ADD CONSTRAINT "remittance_sessions_remittance_fk" FOREIGN KEY ("remittance_id", "handling_unit_id")
        REFERENCES "fees"."remittances" ("id", "handling_unit_id");
--> statement-breakpoint
ALTER TABLE "fees"."remittance_lines"
    ADD CONSTRAINT "remittance_lines_remittance_fk" FOREIGN KEY ("remittance_id", "handling_unit_id")
        REFERENCES "fees"."remittances" ("id", "handling_unit_id");
--> statement-breakpoint
-- Whether a deposit slip (bank, reference as a payment slip's is compared: no leading zeros) is already cited in the caller's
-- region: as a customer's bank-slip payment ('payment_slip') or on another remittance ('remittance'), whatever the office. Other
-- offices' rows are past the request's RLS, so this narrow function answers for the region only (the pattern of slip_in_use,
-- 0062); it takes the same lock on the reference, so a payment and a deposit can't both pass at the same moment.
CREATE FUNCTION "fees"."deposit_reference_in_use"(p_bank text, p_norm text, p_self uuid) RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_region constant uuid := kernel.ctx_region();
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_region::text || '|' || p_bank || '|' || p_norm, 0));
    IF EXISTS (
        SELECT 1 FROM fees.payments p
         WHERE p.region_id = v_region AND p.method = 'bank_slip' AND p.voided_at IS NULL
           AND p.bank_code = p_bank AND ltrim(p.slip_reference_norm, '0') = ltrim(p_norm, '0')) THEN
        RETURN 'payment_slip';
    END IF;
    IF EXISTS (
        SELECT 1 FROM fees.remittances r
         WHERE r.region_id = v_region AND r.id <> p_self AND r.deposit_bank = p_bank AND r.deposit_reference_norm = p_norm) THEN
        RETURN 'remittance';
    END IF;
    RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "fees"."deposit_reference_in_use"(text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "fees"."deposit_reference_in_use"(text, text, uuid) TO itrms_app;
--> statement-breakpoint
-- A remittance is prepared, stamped with this transaction's time; only the deposit changes later, once, for the amount due.
CREATE FUNCTION "fees"."remittance_changes"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.state NOT IN ('prepared', 'settled') THEN
            RAISE EXCEPTION 'fees.remittances: a remittance is prepared first'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'remittances_opens_prepared';
        END IF;
        -- the parts are accepted only in the transaction that made the remittance (see remittance_part_guard)
        NEW.prepared_at := now();
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF OLD.state = 'prepared' AND NEW.state = 'deposited'
           AND (to_jsonb(NEW) - ARRAY['org_path', 'state', 'deposit_bank', 'deposit_reference', 'deposit_reference_norm',
                'deposited_on', 'deposited_amount_santim', 'deposited_by', 'deposited_at', 'updated_at', 'updated_by',
                'row_version']) = (to_jsonb(OLD) - ARRAY['org_path', 'state', 'deposit_bank', 'deposit_reference',
                'deposit_reference_norm', 'deposited_on', 'deposited_amount_santim', 'deposited_by', 'deposited_at',
                'updated_at', 'updated_by', 'row_version']) THEN
            IF NEW.deposited_on > (now() AT TIME ZONE 'Africa/Addis_Ababa')::date THEN
                RAISE EXCEPTION 'fees.remittances: the deposit slip is not dated after today'
                    USING ERRCODE = 'check_violation', CONSTRAINT = 'remittances_deposited_on_future';
            END IF;
            CASE fees.deposit_reference_in_use(NEW.deposit_bank, NEW.deposit_reference_norm, NEW.id)
                WHEN 'payment_slip' THEN
                    RAISE EXCEPTION 'fees.remittances: this slip is a customer payment''s'
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'remittances_deposit_is_payment_slip';
                WHEN 'remittance' THEN
                    RAISE EXCEPTION 'fees.remittances: this slip is cited on another remittance'
                        USING ERRCODE = 'unique_violation', CONSTRAINT = 'remittances_deposit_reference_uq';
                ELSE NULL;
            END CASE;
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'fees.remittances: only the deposit is recorded, once: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "remittances_changes" BEFORE INSERT OR UPDATE OR DELETE ON "fees"."remittances"
    FOR EACH ROW EXECUTE FUNCTION "fees"."remittance_changes"();
--> statement-breakpoint
CREATE TRIGGER "remittances_no_truncate" BEFORE TRUNCATE ON "fees"."remittances"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "remittance_sessions_append_only" BEFORE UPDATE OR DELETE ON "fees"."remittance_sessions"
    FOR EACH ROW EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "remittance_sessions_no_truncate" BEFORE TRUNCATE ON "fees"."remittance_sessions"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "remittance_lines_append_only" BEFORE UPDATE OR DELETE ON "fees"."remittance_lines"
    FOR EACH ROW EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "remittance_lines_no_truncate" BEFORE TRUNCATE ON "fees"."remittance_lines"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
-- A session or a line is written in the transaction that made its remittance and never after, so the deferred check of the
-- remittance sees every part. A session covered is closed, of the same office and not later than the day prepared up to.
CREATE FUNCTION "fees"."remittance_part_guard"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    r fees.remittances%ROWTYPE;
    s fees.cashier_sessions%ROWTYPE;
BEGIN
    SELECT * INTO r FROM fees.remittances x WHERE x.id = NEW.remittance_id;
    IF r.id IS NULL OR r.state NOT IN ('prepared', 'settled') OR r.prepared_at <> now() THEN
        RAISE EXCEPTION 'fees.%: a part is written with its remittance, never after', TG_TABLE_NAME
            USING ERRCODE = 'check_violation', CONSTRAINT = 'remittance_parts_with_remittance';
    END IF;
    IF TG_TABLE_NAME = 'remittance_sessions' THEN
        SELECT * INTO s FROM fees.cashier_sessions x WHERE x.id = NEW.session_id;
        IF s.id IS NULL OR s.state <> 'closed' OR s.handling_unit_id <> r.handling_unit_id OR s.business_day > r.period_to THEN
            RAISE EXCEPTION 'fees.remittance_sessions: a remittance covers closed sessions of its own office'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'remittance_sessions_closed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "remittance_sessions_guard" BEFORE INSERT ON "fees"."remittance_sessions"
    FOR EACH ROW EXECUTE FUNCTION "fees"."remittance_part_guard"();
--> statement-breakpoint
CREATE TRIGGER "remittance_lines_guard" BEFORE INSERT ON "fees"."remittance_lines"
    FOR EACH ROW EXECUTE FUNCTION "fees"."remittance_part_guard"();
--> statement-breakpoint
-- The remittance holds to its sums at commit (deferred: the parts are written after it). Total = the receipts of the sessions it
-- covers, less the reversals decided after a till was counted; every receipt line is a line of the order of a payment taken in a
-- covered session, and a session's lines add up to what its first count froze; every reversal line is of an approved reversal
-- marked after the till closed, whose receipt is on this remittance or a committed one (a receipt is on one remittance only), under
-- the account that receipt was booked to; what is due at the bank is the counted cash less the floats; the difference is counted less expected.
CREATE FUNCTION "fees"."check_remittance"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    r fees.remittances%ROWTYPE;
    remittance_id uuid;
    total bigint;
    cash bigint;
    slip bigint;
    rev bigint;
    due bigint;
    diff bigint;
    first_day date;
    last_day date;
    n_sessions integer;
    bad integer;
BEGIN
    IF TG_TABLE_NAME = 'remittances' THEN
        remittance_id := NEW.id;
    ELSE
        remittance_id := to_jsonb(NEW) ->> 'remittance_id';
    END IF;
    SELECT * INTO r FROM fees.remittances x WHERE x.id = remittance_id;
    SELECT coalesce(sum(l.amount_santim), 0),
           coalesce(sum(l.amount_santim) FILTER (WHERE l.kind = 'receipt' AND l.payment_method = 'cash'), 0),
           coalesce(sum(l.amount_santim) FILTER (WHERE l.kind = 'receipt' AND l.payment_method = 'bank_slip'), 0),
           coalesce(sum(l.amount_santim) FILTER (WHERE l.kind = 'reversal'), 0)
      INTO total, cash, slip, rev
      FROM fees.remittance_lines l WHERE l.remittance_id = r.id;
    -- (a) the totals are the lines'
    IF r.revenue_total_santim <> total OR r.cash_santim <> cash OR r.bank_slip_santim <> slip OR r.reversal_santim <> rev THEN
        RAISE EXCEPTION 'fees.remittances: the totals are the sums of its lines'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'remittances_totals';
    END IF;
    SELECT count(*), min(c.business_day), max(c.business_day),
           coalesce(sum(k.counted_santim - c.opening_float_santim), 0),
           coalesce(sum(k.counted_santim - c.expected_cash_santim), 0)
      INTO n_sessions, first_day, last_day, due, diff
      FROM fees.remittance_sessions s
      JOIN fees.cashier_sessions c ON c.id = s.session_id
      LEFT JOIN fees.cashier_session_counts k ON k.id = c.closing_count_id
     WHERE s.remittance_id = r.id;
    IF n_sessions = 0 OR r.period_from <> first_day OR r.period_to < last_day THEN
        RAISE EXCEPTION 'fees.remittances: it covers closed sessions, from the earliest day to the day prepared up to'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'remittances_sessions';
    END IF;
    -- (e) what is due at the bank, and the difference
    IF r.deposit_due_santim <> due OR r.difference_santim <> diff THEN
        RAISE EXCEPTION 'fees.remittances: the deposit due is the counted cash less the floats'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'remittances_deposit_due';
    END IF;
    -- (b) every receipt line is of an order line of a payment taken in a covered session, in its method and at its amount
    SELECT count(*) INTO bad
      FROM fees.remittance_lines l
      LEFT JOIN fees.receipts rc ON rc.id = l.receipt_id
      LEFT JOIN fees.payments p ON p.id = rc.payment_id
      LEFT JOIN fees.payment_order_lines o ON o.order_id = p.order_id AND o."position" = l.order_line_position
     WHERE l.remittance_id = r.id AND l.kind = 'receipt'
       AND (p.id IS NULL OR o.id IS NULL OR rc.handling_unit_id <> l.handling_unit_id OR l.payment_method <> p.method
            OR l.amount_santim <> o.amount_santim OR l.line_key <> o.key
            -- in the frozen set: not voided, or voided after the till was counted
            OR (p.voided_at IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM fees.receipt_reversals w WHERE w.id = p.voided_by_reversal_id AND w.after_till_closed))
            OR NOT EXISTS (SELECT 1 FROM fees.remittance_sessions s WHERE s.remittance_id = r.id AND s.session_id = p.session_id));
    IF bad > 0 THEN
        RAISE EXCEPTION 'fees.remittance_lines: a receipt line is of a payment of a covered session'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'remittance_lines_receipt_of_session';
    END IF;
    -- (c) a session's lines add up to what its first count froze, receipt by receipt
    SELECT count(*) INTO bad
      FROM fees.remittance_sessions s
      JOIN fees.cashier_sessions c ON c.id = s.session_id
     WHERE s.remittance_id = r.id
       AND (coalesce((SELECT sum(l.amount_santim) FROM fees.remittance_lines l
                       JOIN fees.receipts rc ON rc.id = l.receipt_id JOIN fees.payments p ON p.id = rc.payment_id
                      WHERE l.remittance_id = r.id AND l.kind = 'receipt' AND p.session_id = c.id
                        AND l.payment_method = 'cash'), 0) <> c.cash_receipts_santim
         OR coalesce((SELECT sum(l.amount_santim) FROM fees.remittance_lines l
                       JOIN fees.receipts rc ON rc.id = l.receipt_id JOIN fees.payments p ON p.id = rc.payment_id
                      WHERE l.remittance_id = r.id AND l.kind = 'receipt' AND p.session_id = c.id
                        AND l.payment_method = 'bank_slip'), 0) <> c.bank_slip_santim
         OR (SELECT count(DISTINCT l.receipt_id) FROM fees.remittance_lines l
              JOIN fees.receipts rc ON rc.id = l.receipt_id JOIN fees.payments p ON p.id = rc.payment_id
             WHERE l.remittance_id = r.id AND l.kind = 'receipt' AND p.session_id = c.id) <> c.receipt_count);
    IF bad > 0 THEN
        RAISE EXCEPTION 'fees.remittance_lines: the lines of a session are the receipts its first count froze'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'remittance_lines_session_figures';
    END IF;
    -- (d) a reversal line is of an approved reversal decided after the till closed, whose receipt is on this remittance or an
    -- earlier one, under the account that receipt was booked to
    SELECT count(*) INTO bad
      FROM fees.remittance_lines l
      JOIN fees.receipt_reversals v ON v.id = l.reversal_id
     WHERE l.remittance_id = r.id AND l.kind = 'reversal'
       AND (v.state <> 'approved' OR NOT v.after_till_closed OR v.receipt_id <> l.receipt_id
            OR v.handling_unit_id <> l.handling_unit_id
            OR NOT EXISTS (
                SELECT 1 FROM fees.remittance_lines q
                 WHERE q.kind = 'receipt' AND q.receipt_id = l.receipt_id AND q.order_line_position = l.order_line_position
                   AND q.amount_santim = -l.amount_santim AND q.line_key = l.line_key AND q.payment_method = l.payment_method
                   AND q.account_code = l.account_code AND q.budget_category = l.budget_category
                   AND q.account_name = l.account_name AND q.mapped_by_default = l.mapped_by_default));
    IF bad > 0 THEN
        RAISE EXCEPTION 'fees.remittance_lines: a reversal line is of a reversal after the till closed, of a receipt remitted'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'remittance_lines_reversal_of_receipt';
    END IF;
    -- a reversal is written whole: a line for each line of its order
    SELECT count(*) INTO bad
      FROM (SELECT l.reversal_id, count(*) AS n FROM fees.remittance_lines l
             WHERE l.remittance_id = r.id AND l.kind = 'reversal' GROUP BY l.reversal_id) g
      JOIN fees.receipt_reversals v ON v.id = g.reversal_id
     WHERE g.n <> (SELECT count(*) FROM fees.payment_order_lines o WHERE o.order_id = v.order_id);
    IF bad > 0 THEN
        RAISE EXCEPTION 'fees.remittance_lines: a reversal is written with a line for each line of its order'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'remittance_lines_reversal_whole';
    END IF;
    RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "fees"."check_remittance"() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "remittances_sums" AFTER INSERT ON "fees"."remittances"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "fees"."check_remittance"();
--> statement-breakpoint
-- and on every part: it may run more than once in a transaction, the check is set-based and reads the whole remittance
CREATE CONSTRAINT TRIGGER "remittance_sessions_sums" AFTER INSERT ON "fees"."remittance_sessions"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "fees"."check_remittance"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "remittance_lines_sums" AFTER INSERT ON "fees"."remittance_lines"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "fees"."check_remittance"();
--> statement-breakpoint
GRANT SELECT, INSERT ON "fees"."remittances", "fees"."remittance_sessions", "fees"."remittance_lines" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "deposit_bank", "deposit_reference", "deposit_reference_norm", "deposited_on", "deposited_amount_santim",
    "deposited_by", "deposited_at", "updated_at", "updated_by", "row_version") ON "fees"."remittances" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('fees.remittances', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.remittance_sessions', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.remittance_lines', 'transaction', 'org_path');