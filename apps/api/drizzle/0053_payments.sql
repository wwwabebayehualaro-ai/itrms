CREATE TABLE "fees"."payment_order_lines" (
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
	"position" integer NOT NULL,
	"key" text NOT NULL,
	"label" jsonb NOT NULL,
	"quantity" integer,
	"amount_santim" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fees"."payment_orders" (
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
	"case_number" bigint NOT NULL,
	"service_code" text NOT NULL,
	"service_name" jsonb NOT NULL,
	"case_fee_id" uuid NOT NULL,
	"total_santim" bigint NOT NULL,
	"demo" boolean NOT NULL,
	"collection" text NOT NULL,
	"due_on" date NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"settled_payment_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "fees"."payments" (
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
	"method" text NOT NULL,
	"amount_santim" bigint NOT NULL,
	"bank_code" text,
	"slip_reference" text,
	"slip_reference_norm" text,
	"slip_date" date,
	"received_from" text NOT NULL,
	"received_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_reversal_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fees"."receipt_reversals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"receipt_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "fees"."receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"source" text NOT NULL,
	"number" text NOT NULL,
	"fiscal_year" integer,
	"sequence" bigint,
	"pad_series" text,
	"pad_serial" text,
	"amount_santim" bigint NOT NULL,
	"issued_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fees"."payment_order_lines" ADD CONSTRAINT "payment_order_lines_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."payment_order_lines" ADD CONSTRAINT "payment_order_lines_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "fees"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."payment_orders" ADD CONSTRAINT "payment_orders_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."payment_orders" ADD CONSTRAINT "payment_orders_case_fee_id_case_fees_id_fk" FOREIGN KEY ("case_fee_id") REFERENCES "fees"."case_fees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."payments" ADD CONSTRAINT "payments_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."payments" ADD CONSTRAINT "payments_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "fees"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."receipt_reversals" ADD CONSTRAINT "receipt_reversals_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."receipt_reversals" ADD CONSTRAINT "receipt_reversals_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "fees"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."receipt_reversals" ADD CONSTRAINT "receipt_reversals_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "fees"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."receipt_reversals" ADD CONSTRAINT "receipt_reversals_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "fees"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."receipts" ADD CONSTRAINT "receipts_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "fees"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."receipts" ADD CONSTRAINT "receipts_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "fees"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_lines_position_uq" ON "fees"."payment_order_lines" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "payment_order_lines_org_path_gist" ON "fees"."payment_order_lines" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_case_live_uq" ON "fees"."payment_orders" USING btree ("case_id") WHERE state <> 'cancelled';--> statement-breakpoint
CREATE INDEX "payment_orders_queue_idx" ON "fees"."payment_orders" USING btree ("handling_unit_id","state","created_at");--> statement-breakpoint
CREATE INDEX "payment_orders_org_path_gist" ON "fees"."payment_orders" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_live_uq" ON "fees"."payments" USING btree ("order_id") WHERE voided_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_slip_live_uq" ON "fees"."payments" USING btree ("region_id","bank_code","slip_reference_norm") WHERE method = 'bank_slip' AND voided_at IS NULL;--> statement-breakpoint
CREATE INDEX "payments_org_path_gist" ON "fees"."payments" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_reversals_live_uq" ON "fees"."receipt_reversals" USING btree ("receipt_id") WHERE state IN ('requested', 'approved');--> statement-breakpoint
CREATE INDEX "receipt_reversals_inbox_idx" ON "fees"."receipt_reversals" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "receipt_reversals_org_path_gist" ON "fees"."receipt_reversals" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_payment_uq" ON "fees"."receipts" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_itrms_uq" ON "fees"."receipts" USING btree ("handling_unit_id","fiscal_year","sequence") WHERE source = 'itrms';--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_pad_uq" ON "fees"."receipts" USING btree ("handling_unit_id","pad_series","pad_serial") WHERE source = 'pad';--> statement-breakpoint
CREATE INDEX "receipts_org_path_gist" ON "fees"."receipts" USING gist ("org_path");--> statement-breakpoint
-- Hand-written (task 0.22b, ADR-0042): payment orders, payments, receipts and their reversals, class T at the case's
-- handling unit. Scope triggers, checks, the keys to other slices' tables, the append-only rules (a payment is voided
-- once, by an approved reversal; a decided reversal never changes), grants, RLS; and the case timeline's `payment` kind.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."payment_orders"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."payment_order_lines"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."payments"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."receipts"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "fees"."receipt_reversals"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
ALTER TABLE "fees"."payment_orders"
    ADD CONSTRAINT "payment_orders_total_check" CHECK ("total_santim" > 0),
    ADD CONSTRAINT "payment_orders_state_check" CHECK ("state" IN ('open', 'settled', 'cancelled')),
    ADD CONSTRAINT "payment_orders_collection_check" CHECK ("collection" IN ('cashier', 'elsewhere')),
    ADD CONSTRAINT "payment_orders_settled_check" CHECK (("state" = 'settled') = ("settled_payment_id" IS NOT NULL)),
    ADD CONSTRAINT "payment_orders_cancelled_check" CHECK (
        ("state" = 'cancelled') = ("cancelled_at" IS NOT NULL) AND ("cancelled_at" IS NULL) = ("cancel_reason" IS NULL)),
    ADD CONSTRAINT "payment_orders_cancel_reason_check" CHECK (
        "cancel_reason" IS NULL OR "cancel_reason" IN ('reassessed', 'case_closed')),
    ADD CONSTRAINT "payment_orders_service_name_check" CHECK (
        jsonb_typeof("service_name") = 'object' AND pg_column_size("service_name") <= 4096),
    ADD CONSTRAINT "payment_orders_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases" ("id");
--> statement-breakpoint
ALTER TABLE "fees"."payment_order_lines"
    ADD CONSTRAINT "payment_order_lines_position_check" CHECK ("position" >= 1),
    ADD CONSTRAINT "payment_order_lines_amount_check" CHECK ("amount_santim" > 0),
    ADD CONSTRAINT "payment_order_lines_quantity_check" CHECK ("quantity" IS NULL OR "quantity" >= 0),
    ADD CONSTRAINT "payment_order_lines_label_check" CHECK (
        jsonb_typeof("label") = 'object' AND pg_column_size("label") <= 4096);
--> statement-breakpoint
ALTER TABLE "fees"."payments"
    ADD CONSTRAINT "payments_amount_check" CHECK ("amount_santim" > 0),
    ADD CONSTRAINT "payments_method_check" CHECK ("method" IN ('cash', 'bank_slip')),
    -- a bank slip names its bank, reference and date; cash none of them
    ADD CONSTRAINT "payments_slip_check" CHECK (
        ("method" = 'bank_slip') = ("bank_code" IS NOT NULL)
        AND ("bank_code" IS NULL) = ("slip_reference" IS NULL)
        AND ("bank_code" IS NULL) = ("slip_reference_norm" IS NULL)
        AND ("bank_code" IS NULL) = ("slip_date" IS NULL)),
    ADD CONSTRAINT "payments_received_from_check" CHECK (length("received_from") BETWEEN 2 AND 200),
    ADD CONSTRAINT "payments_void_check" CHECK (("voided_at" IS NULL) = ("voided_by_reversal_id" IS NULL)),
    ADD CONSTRAINT "payments_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases" ("id");
--> statement-breakpoint
ALTER TABLE "fees"."receipts"
    ADD CONSTRAINT "receipts_amount_check" CHECK ("amount_santim" > 0),
    -- a counter's receipt names its year and sequence; a pad's its series and serial; never both
    ADD CONSTRAINT "receipts_source_check" CHECK (
        ("source" = 'itrms' AND "fiscal_year" IS NOT NULL AND "sequence" IS NOT NULL
            AND "pad_series" IS NULL AND "pad_serial" IS NULL)
        OR ("source" = 'pad' AND "pad_series" IS NOT NULL AND "pad_serial" IS NOT NULL
            AND "fiscal_year" IS NULL AND "sequence" IS NULL)),
    ADD CONSTRAINT "receipts_number_check" CHECK (length("number") BETWEEN 1 AND 80),
    ADD CONSTRAINT "receipts_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases" ("id");
--> statement-breakpoint
ALTER TABLE "fees"."receipt_reversals"
    ADD CONSTRAINT "receipt_reversals_state_check" CHECK ("state" IN ('requested', 'approved', 'rejected')),
    ADD CONSTRAINT "receipt_reversals_decided_check" CHECK (
        ("state" = 'requested') = ("decided_by" IS NULL) AND ("decided_by" IS NULL) = ("decided_at" IS NULL)),
    -- separation of duties (roles-and-permissions.md): never the person who asked, nor the cashier who took the money
    ADD CONSTRAINT "receipt_reversals_sod_check" CHECK (
        "decided_by" IS NULL OR ("decided_by" <> "requested_by" AND "decided_by" <> "cashier_id")),
    ADD CONSTRAINT "receipt_reversals_reason_check" CHECK (length("reason") BETWEEN 10 AND 500),
    ADD CONSTRAINT "receipt_reversals_note_check" CHECK ("note" IS NULL OR length("note") <= 500),
    ADD CONSTRAINT "receipt_reversals_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases" ("id");
--> statement-breakpoint
-- an order is settled by a payment of its own, and a payment voided by a reversal of its own
ALTER TABLE "fees"."payments" ADD CONSTRAINT "payments_id_order_uq" UNIQUE ("id", "order_id");
--> statement-breakpoint
ALTER TABLE "fees"."payment_orders"
    ADD CONSTRAINT "payment_orders_settled_payment_fk" FOREIGN KEY ("settled_payment_id", "id")
        REFERENCES "fees"."payments" ("id", "order_id");
--> statement-breakpoint
ALTER TABLE "fees"."receipt_reversals" ADD CONSTRAINT "receipt_reversals_id_payment_uq" UNIQUE ("id", "payment_id");
--> statement-breakpoint
ALTER TABLE "fees"."payments"
    ADD CONSTRAINT "payments_voided_by_fk" FOREIGN KEY ("voided_by_reversal_id", "id")
        REFERENCES "fees"."receipt_reversals" ("id", "payment_id");
--> statement-breakpoint
CREATE INDEX "payment_orders_case_idx" ON "fees"."payment_orders" ("case_id");
--> statement-breakpoint
-- A payment changes only when it is voided, once: everything else of it is append-only (only a unit move rewrites its
-- org_path, through the set_org_path trigger).
CREATE FUNCTION "fees"."void_once"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY['org_path', 'voided_at', 'voided_by_reversal_id', 'updated_at', 'updated_by',
                'row_version']) = (to_jsonb(OLD) - ARRAY['org_path', 'voided_at', 'voided_by_reversal_id', 'updated_at',
                'updated_by', 'row_version']) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'fees.payments is append-only (voided once): % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payments_void_once" BEFORE UPDATE OR DELETE ON "fees"."payments"
    FOR EACH ROW EXECUTE FUNCTION "fees"."void_once"();
--> statement-breakpoint
CREATE TRIGGER "payments_no_truncate" BEFORE TRUNCATE ON "fees"."payments"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
-- A reversal is decided once: requested → approved or rejected, and never changes after.
CREATE FUNCTION "fees"."decided_once"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF OLD.state = 'requested' AND NEW.state IN ('approved', 'rejected')
           AND (to_jsonb(NEW) - ARRAY['org_path', 'state', 'decided_by', 'decided_at', 'note', 'updated_at',
                'updated_by', 'row_version']) = (to_jsonb(OLD) - ARRAY['org_path', 'state', 'decided_by', 'decided_at',
                'note', 'updated_at', 'updated_by', 'row_version']) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'fees.receipt_reversals is decided once: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "receipt_reversals_decided_once" BEFORE UPDATE OR DELETE ON "fees"."receipt_reversals"
    FOR EACH ROW EXECUTE FUNCTION "fees"."decided_once"();
--> statement-breakpoint
CREATE TRIGGER "receipt_reversals_no_truncate" BEFORE TRUNCATE ON "fees"."receipt_reversals"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "payment_order_lines_append_only" BEFORE UPDATE OR DELETE ON "fees"."payment_order_lines"
    FOR EACH ROW EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "payment_order_lines_no_truncate" BEFORE TRUNCATE ON "fees"."payment_order_lines"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "receipts_append_only" BEFORE UPDATE OR DELETE ON "fees"."receipts"
    FOR EACH ROW EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "receipts_no_truncate" BEFORE TRUNCATE ON "fees"."receipts"
    FOR EACH STATEMENT EXECUTE FUNCTION "fees"."append_only"();
--> statement-breakpoint
GRANT SELECT, INSERT ON "fees"."payment_orders", "fees"."payment_order_lines", "fees"."payments", "fees"."receipts",
    "fees"."receipt_reversals" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "settled_payment_id", "cancelled_at", "cancel_reason", "updated_at", "updated_by", "row_version")
    ON "fees"."payment_orders" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("voided_at", "voided_by_reversal_id", "updated_at", "updated_by", "row_version")
    ON "fees"."payments" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "decided_by", "decided_at", "note", "updated_at", "updated_by", "row_version")
    ON "fees"."receipt_reversals" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('fees.payment_orders', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.payment_order_lines', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.payments', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.receipts', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('fees.receipt_reversals', 'transaction', 'org_path');
--> statement-breakpoint
-- the case timeline names a payment's changes (paid, a reversal asked for, decided)
ALTER TABLE "workflow"."case_events" DROP CONSTRAINT "case_events_kind_check";
--> statement-breakpoint
ALTER TABLE "workflow"."case_events"
    ADD CONSTRAINT "case_events_kind_check" CHECK ("kind" IN ('started', 'transition', 'routed', 'comment', 'payment'));
