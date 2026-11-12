ALTER TABLE "vehicles"."vehicles" ADD COLUMN "migration_source" text;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "paper_reference" text;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "migration_case_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "migration_verified_by" uuid;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD COLUMN "migration_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_migration_source_check" CHECK ("vehicles"."vehicles"."migration_source" in ('back_capture', 'import'));--> statement-breakpoint
ALTER TABLE "vehicles"."vehicles" ADD CONSTRAINT "vehicles_migration_check" CHECK (("vehicles"."vehicles"."migration_source" is null) = ("vehicles"."vehicles"."paper_reference" is null)
                        and coalesce(length("vehicles"."vehicles"."paper_reference"), 1) between 1 and 60
                        and ("vehicles"."vehicles"."migration_source" is distinct from 'back_capture'
                             or ("vehicles"."vehicles"."migration_case_id" is not null and "vehicles"."vehicles"."migration_verified_by" is not null
                                 and "vehicles"."vehicles"."migration_verified_at" is not null))
                        and ("vehicles"."vehicles"."migration_verified_by" is null) = ("vehicles"."vehicles"."migration_verified_at" is null));