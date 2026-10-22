CREATE TABLE "kernel"."idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"region_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"user_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel"."number_counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"region_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"unit_id" uuid NOT NULL,
	"key" text NOT NULL,
	"pattern" text NOT NULL,
	"last_value" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel"."outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"region_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"unit_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enqueued_at" timestamp with time zone,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "kernel"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."number_counters" ADD CONSTRAINT "number_counters_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."outbox_events" ADD CONSTRAINT "outbox_events_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_uq" ON "kernel"."idempotency_keys" USING btree ("user_id","unit_id","method","path","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "kernel"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "number_counters_unit_key_uq" ON "kernel"."number_counters" USING btree ("unit_id","key");--> statement-breakpoint
CREATE INDEX "number_counters_org_path_gist" ON "kernel"."number_counters" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "kernel"."outbox_events" USING btree ("available_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_enqueued_idx" ON "kernel"."outbox_events" USING btree ("enqueued_at") WHERE status = 'enqueued';--> statement-breakpoint
CREATE INDEX "outbox_events_org_path_gist" ON "kernel"."outbox_events" USING gist ("org_path");