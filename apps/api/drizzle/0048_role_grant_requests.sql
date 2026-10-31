CREATE TABLE "kernel"."role_grant_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"user_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"assignment_id" uuid
);
--> statement-breakpoint
ALTER TABLE "kernel"."role_assignments" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "kernel"."role_grant_requests" ADD CONSTRAINT "role_grant_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "kernel"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."role_grant_requests" ADD CONSTRAINT "role_grant_requests_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."role_grant_requests" ADD CONSTRAINT "role_grant_requests_assignment_id_role_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "kernel"."role_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_grant_requests_unit_idx" ON "kernel"."role_grant_requests" USING btree ("unit_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "role_grant_requests_pending_uq" ON "kernel"."role_grant_requests" USING btree ("user_id","unit_id","role_key") WHERE state = 'pending';--> statement-breakpoint
-- Hand-written (task 0.21e, SEC-AC-6): the scope trigger, checks, grants and RLS of the requests. A request is decided
-- once: only its state and the decision's columns are ever written, only while it waits, and nothing is deleted. Four
-- eyes in the database too: whoever confirms or refuses is neither who asked nor who is granted, and an assignment's
-- confirmer is not who asked for it. A request left too long is closed as expired (by nobody) when it is asked again.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."role_grant_requests"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "kernel"."role_grant_requests"
    ADD CONSTRAINT "role_grant_requests_role_key_check" CHECK ("role_key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$'),
    ADD CONSTRAINT "role_grant_requests_period_check" CHECK (
        "valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from"),
    ADD CONSTRAINT "role_grant_requests_reason_check" CHECK (length(btrim("reason")) BETWEEN 3 AND 500),
    ADD CONSTRAINT "role_grant_requests_state_check" CHECK (
        "state" IN ('pending', 'confirmed', 'rejected', 'withdrawn', 'expired')),
    -- a decided request says when; who decided, unless it expired; a confirmed one, the assignment it made
    ADD CONSTRAINT "role_grant_requests_decision_check" CHECK (
        ("state" = 'pending') = ("decided_at" IS NULL)
        AND ("state" IN ('pending', 'expired')) = ("decided_by" IS NULL)
        AND ("state" = 'confirmed') = ("assignment_id" IS NOT NULL)),
    ADD CONSTRAINT "role_grant_requests_four_eyes_check" CHECK (
        "state" NOT IN ('confirmed', 'rejected')
        OR ("decided_by" IS DISTINCT FROM "created_by" AND "decided_by" IS DISTINCT FROM "user_id")),
    ADD CONSTRAINT "role_grant_requests_withdrawn_check" CHECK (
        "state" <> 'withdrawn' OR "decided_by" = "created_by"),
    ADD CONSTRAINT "role_grant_requests_decision_reason_check" CHECK (
        "decision_reason" IS NULL OR length(btrim("decision_reason")) BETWEEN 3 AND 500);
--> statement-breakpoint
ALTER TABLE "kernel"."role_assignments"
    ADD CONSTRAINT "role_assignments_four_eyes_check" CHECK (
        "confirmed_by" IS NULL
        OR ("confirmed_by" IS DISTINCT FROM "granted_by" AND "confirmed_by" IS DISTINCT FROM "user_id"));
--> statement-breakpoint
CREATE FUNCTION "kernel"."role_grant_requests_decided_once"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF OLD.state <> 'pending' AND (NEW.state, NEW.decided_by, NEW.decided_at, NEW.decision_reason, NEW.assignment_id)
        IS DISTINCT FROM (OLD.state, OLD.decided_by, OLD.decided_at, OLD.decision_reason, OLD.assignment_id) THEN
        RAISE EXCEPTION 'kernel.role_grant_requests: a request is decided once' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "role_grant_requests_decided_once" BEFORE UPDATE ON "kernel"."role_grant_requests"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."role_grant_requests_decided_once"();
--> statement-breakpoint
GRANT SELECT, INSERT ON "kernel"."role_grant_requests" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("state", "decided_by", "decided_at", "decision_reason", "assignment_id", "updated_at", "updated_by",
    "row_version") ON "kernel"."role_grant_requests" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.role_grant_requests', 'transaction', 'org_path');
