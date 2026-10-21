ALTER TABLE "kernel"."unit_type_roles" ADD COLUMN "delegable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- SECURITY DEFINER functions look up names with pg_temp last, so no temporary object can stand in for a catalog one
ALTER FUNCTION "kernel"."record_context_free_event"(text, jsonb, uuid, text, text) SET search_path = pg_catalog, pg_temp;
