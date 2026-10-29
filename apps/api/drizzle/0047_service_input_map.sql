ALTER TABLE "services"."service_versions" ADD COLUMN "input_map" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "services"."service_versions"
    ADD CONSTRAINT "service_versions_input_map_check" CHECK (
        jsonb_typeof("input_map") = 'object' AND pg_column_size("input_map") <= 65536);
