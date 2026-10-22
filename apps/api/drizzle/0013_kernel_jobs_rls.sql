-- Counters, idempotency keys and the outbox (task 0.11), hand-written: scope triggers, checks, the app's grants and the
-- class T policies. The worker's system pool (itrms_system, BYPASSRLS) relays and sweeps across scopes; it has the
-- default privileges of roles.psql.

CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."number_counters"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."idempotency_keys"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "kernel"."outbox_events"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('unit_id');
--> statement-breakpoint
ALTER TABLE "kernel"."number_counters"
    ADD CONSTRAINT "number_counters_key_check" CHECK ("key" ~ '^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9_.-]*$'),
    ADD CONSTRAINT "number_counters_pattern_check" CHECK ("pattern" ~ '\{seq(:0\d)?\}' AND length("pattern") <= 80),
    ADD CONSTRAINT "number_counters_last_value_check" CHECK ("last_value" >= 0);
--> statement-breakpoint
ALTER TABLE "kernel"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_key_check" CHECK (length("key") BETWEEN 1 AND 255),
    ADD CONSTRAINT "idempotency_keys_method_check" CHECK ("method" = 'POST'),
    ADD CONSTRAINT "idempotency_keys_status_check" CHECK ("status_code" BETWEEN 200 AND 599),
    ADD CONSTRAINT "idempotency_keys_expiry_check" CHECK ("expires_at" > "created_at");
--> statement-breakpoint
ALTER TABLE "kernel"."outbox_events"
    ADD CONSTRAINT "outbox_events_type_check" CHECK ("type" ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v[1-9][0-9]*$'),
    ADD CONSTRAINT "outbox_events_status_check" CHECK ("status" IN ('pending', 'enqueued', 'done', 'dead')),
    ADD CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0);
--> statement-breakpoint
-- a counter is created by the installation's configuration (the owner); request code only takes the next number
GRANT SELECT ON "kernel"."number_counters" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("last_value", "updated_at") ON "kernel"."number_counters" TO itrms_app;
--> statement-breakpoint
-- an expired record of the same key is replaced by the new request
GRANT SELECT, INSERT, DELETE ON "kernel"."idempotency_keys" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status_code", "response") ON "kernel"."idempotency_keys" TO itrms_app;
--> statement-breakpoint
-- request code writes events; an administrator sees them and sends a dead one back (job:retry)
GRANT SELECT, INSERT ON "kernel"."outbox_events" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "available_at", "attempts", "last_error") ON "kernel"."outbox_events" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.number_counters', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.idempotency_keys', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('kernel.outbox_events', 'transaction', 'org_path');
