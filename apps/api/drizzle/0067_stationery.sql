CREATE TABLE "fees"."stationery_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"receiving_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"reference" text NOT NULL,
	"received_on" date NOT NULL,
	"variant" text,
	"valid_efy" smallint,
	"unit_cost_santim" bigint,
	"quantity" integer NOT NULL,
	"first_key" text NOT NULL,
	"last_key" text NOT NULL,
	"note" text,
	CONSTRAINT "stationery_batches_kind_check" CHECK ("fees"."stationery_batches"."kind" in ('libre_booklet', 'licence_blank', 'bolo_sticker', 'receipt_leaf')),
	CONSTRAINT "stationery_batches_source_check" CHECK ("fees"."stationery_batches"."source" in ('regional_bureau', 'ministry', 'printer', 'other')),
	CONSTRAINT "stationery_batches_variant_check" CHECK (("fees"."stationery_batches"."variant" is null or "fees"."stationery_batches"."variant" ~ '^[a-z0-9_]{1,20}$') and ("fees"."stationery_batches"."valid_efy" is null or "fees"."stationery_batches"."valid_efy" between 2000 and 2100) and ("fees"."stationery_batches"."unit_cost_santim" is null or "fees"."stationery_batches"."unit_cost_santim" >= 0)),
	CONSTRAINT "stationery_batches_quantity_check" CHECK ("fees"."stationery_batches"."quantity" between 1 and 10000),
	CONSTRAINT "stationery_batches_text_check" CHECK (length("fees"."stationery_batches"."reference") between 1 and 60 and coalesce(length("fees"."stationery_batches"."note"), 0) <= 500)
);
--> statement-breakpoint
CREATE TABLE "fees"."stationery_closings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"closed_on" date NOT NULL,
	"expected" integer NOT NULL,
	"counted" integer NOT NULL,
	"missing_keys" text[] NOT NULL,
	"missing_count" integer NOT NULL,
	"unexpected_keys" text[] NOT NULL,
	"unexpected_count" integer NOT NULL,
	"note" text,
	CONSTRAINT "stationery_closings_kind_check" CHECK ("fees"."stationery_closings"."kind" in ('libre_booklet', 'licence_blank', 'bolo_sticker', 'receipt_leaf')),
	CONSTRAINT "stationery_closings_counts_check" CHECK ("fees"."stationery_closings"."expected" >= 0 and "fees"."stationery_closings"."counted" >= 0 and "fees"."stationery_closings"."missing_count" >= cardinality("fees"."stationery_closings"."missing_keys") and "fees"."stationery_closings"."unexpected_count" >= cardinality("fees"."stationery_closings"."unexpected_keys") and cardinality("fees"."stationery_closings"."missing_keys") <= 200 and cardinality("fees"."stationery_closings"."unexpected_keys") <= 200),
	CONSTRAINT "stationery_closings_note_check" CHECK (coalesce(length("fees"."stationery_closings"."note"), 0) <= 500)
);
--> statement-breakpoint
CREATE TABLE "fees"."stationery_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"holder_unit_id" uuid NOT NULL,
	"holder_org_path" "ltree" DEFAULT '' NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"variant" text,
	"valid_efy" smallint,
	"series" text NOT NULL,
	"serial" integer NOT NULL,
	"item_key" text NOT NULL,
	"width" smallint NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"status_on" date NOT NULL,
	"used_for_table" text,
	"used_for_id" uuid,
	"case_id" uuid,
	"end_reason" text,
	"note" text,
	"last_movement_id" uuid,
	CONSTRAINT "stationery_items_kind_check" CHECK ("fees"."stationery_items"."kind" in ('libre_booklet', 'licence_blank', 'bolo_sticker', 'receipt_leaf')),
	CONSTRAINT "stationery_items_status_check" CHECK ("fees"."stationery_items"."status" in ('in_stock', 'allocated', 'used', 'spoiled', 'void', 'missing')),
	CONSTRAINT "stationery_items_key_check" CHECK ("fees"."stationery_items"."series" ~ '^[A-Z]{0,6}$' and "fees"."stationery_items"."serial" between 1 and 99999999 and "fees"."stationery_items"."width" between 1 and 8 and "fees"."stationery_items"."item_key" = "fees"."stationery_items"."series" || lpad("fees"."stationery_items"."serial"::text, "fees"."stationery_items"."width", '0')),
	CONSTRAINT "stationery_items_used_check" CHECK (("fees"."stationery_items"."status" = 'used') = ("fees"."stationery_items"."used_for_id" is not null and "fees"."stationery_items"."used_for_table" is not null)),
	CONSTRAINT "stationery_items_end_check" CHECK (("fees"."stationery_items"."end_reason" is null) = ("fees"."stationery_items"."status" not in ('spoiled', 'void', 'missing')) and ("fees"."stationery_items"."end_reason" is null or "fees"."stationery_items"."end_reason" in ('misprinted', 'damaged', 'lost', 'stolen', 'not_found_at_count', 'other'))),
	CONSTRAINT "stationery_items_note_check" CHECK (coalesce(length("fees"."stationery_items"."note"), 0) <= 500)
);
--> statement-breakpoint
CREATE TABLE "fees"."stationery_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"movement" text NOT NULL,
	"from_unit_id" uuid,
	"to_unit_id" uuid,
	"batch_id" uuid,
	"of_movement_id" uuid,
	"quantity" integer NOT NULL,
	"first_key" text NOT NULL,
	"last_key" text NOT NULL,
	"case_id" uuid,
	"occurred_on" date NOT NULL,
	"reason" text,
	"note" text,
	CONSTRAINT "stationery_movements_kind_check" CHECK ("fees"."stationery_movements"."kind" in ('libre_booklet', 'licence_blank', 'bolo_sticker', 'receipt_leaf')),
	CONSTRAINT "stationery_movements_movement_check" CHECK ("fees"."stationery_movements"."movement" in ('receive', 'allocate', 'accept', 'recall', 'use', 'spoil', 'write_off')),
	CONSTRAINT "stationery_movements_quantity_check" CHECK ("fees"."stationery_movements"."quantity" between 1 and 10000),
	CONSTRAINT "stationery_movements_units_check" CHECK (("fees"."stationery_movements"."movement" in ('allocate', 'recall')) = ("fees"."stationery_movements"."from_unit_id" is not null and "fees"."stationery_movements"."to_unit_id" is not null)),
	CONSTRAINT "stationery_movements_batch_check" CHECK (("fees"."stationery_movements"."movement" = 'receive') = ("fees"."stationery_movements"."batch_id" is not null)),
	CONSTRAINT "stationery_movements_accept_check" CHECK (("fees"."stationery_movements"."movement" = 'accept') = ("fees"."stationery_movements"."of_movement_id" is not null)),
	CONSTRAINT "stationery_movements_reason_check" CHECK (("fees"."stationery_movements"."movement" not in ('recall', 'write_off', 'spoil') or length("fees"."stationery_movements"."reason") >= 3) and coalesce(length("fees"."stationery_movements"."reason"), 0) <= 500 and coalesce(length("fees"."stationery_movements"."note"), 0) <= 500)
);
--> statement-breakpoint
ALTER TABLE "competency"."licence_print_batch_items" ADD COLUMN "card_key" text;--> statement-breakpoint
ALTER TABLE "competency"."licence_print_batch_items" ADD COLUMN "stationery_item_id" uuid;--> statement-breakpoint
ALTER TABLE "fees"."stationery_batches" ADD CONSTRAINT "stationery_batches_receiving_unit_id_org_units_id_fk" FOREIGN KEY ("receiving_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."stationery_closings" ADD CONSTRAINT "stationery_closings_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."stationery_items" ADD CONSTRAINT "stationery_items_holder_unit_id_org_units_id_fk" FOREIGN KEY ("holder_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."stationery_items" ADD CONSTRAINT "stationery_items_batch_id_stationery_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "fees"."stationery_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."stationery_movements" ADD CONSTRAINT "stationery_movements_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."stationery_movements" ADD CONSTRAINT "stationery_movements_from_unit_id_org_units_id_fk" FOREIGN KEY ("from_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."stationery_movements" ADD CONSTRAINT "stationery_movements_to_unit_id_org_units_id_fk" FOREIGN KEY ("to_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees"."stationery_movements" ADD CONSTRAINT "stationery_movements_batch_id_stationery_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "fees"."stationery_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stationery_batches_reference_uq" ON "fees"."stationery_batches" USING btree ("region_id","kind","reference");--> statement-breakpoint
CREATE INDEX "stationery_batches_org_path_gist" ON "fees"."stationery_batches" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "stationery_closings_day_uq" ON "fees"."stationery_closings" USING btree ("unit_id","kind","closed_on");--> statement-breakpoint
CREATE INDEX "stationery_closings_org_path_gist" ON "fees"."stationery_closings" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "stationery_items_serial_uq" ON "fees"."stationery_items" USING btree ("region_id","kind","series","serial");--> statement-breakpoint
CREATE UNIQUE INDEX "stationery_items_used_for_uq" ON "fees"."stationery_items" USING btree ("kind","used_for_table","used_for_id") WHERE used_for_id is not null;--> statement-breakpoint
CREATE INDEX "stationery_items_holder_status_idx" ON "fees"."stationery_items" USING btree ("region_id","holder_unit_id","kind","status","variant","series","serial");--> statement-breakpoint
CREATE INDEX "stationery_items_holder_gist" ON "fees"."stationery_items" USING gist ("holder_org_path");--> statement-breakpoint
CREATE INDEX "stationery_items_last_movement_idx" ON "fees"."stationery_items" USING btree ("last_movement_id");--> statement-breakpoint
CREATE INDEX "stationery_items_key_idx" ON "fees"."stationery_items" USING btree ("region_id","item_key");--> statement-breakpoint
CREATE INDEX "stationery_movements_org_path_gist" ON "fees"."stationery_movements" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "stationery_movements_unit_idx" ON "fees"."stationery_movements" USING btree ("region_id","unit_id","kind","movement");--> statement-breakpoint
CREATE INDEX "stationery_movements_of_idx" ON "fees"."stationery_movements" USING btree ("of_movement_id");