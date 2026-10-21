-- The audit log is append-only (ADR-0018): a trigger refuses UPDATE, DELETE and TRUNCATE for every role, the owner and the
-- system role included, and the API's role may only add and read rows. Hand-written: drizzle-kit has no triggers or grants.

ALTER TABLE "kernel"."audit_log"
    ADD CONSTRAINT "audit_log_action_check" CHECK ("action" IN ('insert', 'update', 'delete', 'event'));
--> statement-breakpoint
ALTER TABLE "kernel"."audit_log"
    ADD CONSTRAINT "audit_log_row_change_check" CHECK ("action" = 'event' OR ("table_name" IS NOT NULL AND "row_id" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "kernel"."audit_log"
    ADD CONSTRAINT "audit_log_event_check" CHECK ("action" <> 'event' OR "event_type" IS NOT NULL);
--> statement-breakpoint
CREATE FUNCTION "kernel"."audit_log_append_only"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'kernel.audit_log is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_update_delete"
    BEFORE UPDATE OR DELETE ON "kernel"."audit_log"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."audit_log_append_only"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_truncate"
    BEFORE TRUNCATE ON "kernel"."audit_log"
    FOR EACH STATEMENT EXECUTE FUNCTION "kernel"."audit_log_append_only"();
--> statement-breakpoint
GRANT USAGE ON SCHEMA "kernel" TO itrms_app;
--> statement-breakpoint
REVOKE ALL ON "kernel"."audit_log" FROM itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "kernel"."audit_log" TO itrms_app;
--> statement-breakpoint
-- the system role writes events too (from the worker), but never changes one
REVOKE UPDATE, DELETE, TRUNCATE ON "kernel"."audit_log" FROM itrms_system;
