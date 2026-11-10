CREATE TABLE "vehicles"."plate_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"receiving_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"reference" text NOT NULL,
	"received_on" date NOT NULL,
	"quantity" integer NOT NULL,
	"first_key" text NOT NULL,
	"last_key" text NOT NULL,
	"note" text,
	CONSTRAINT "plate_batches_quantity_check" CHECK ("vehicles"."plate_batches"."quantity" between 1 and 10000),
	CONSTRAINT "plate_batches_text_check" CHECK (length("vehicles"."plate_batches"."reference") between 1 and 60 and coalesce(length("vehicles"."plate_batches"."note"), 0) <= 500)
);
--> statement-breakpoint
CREATE TABLE "vehicles"."plate_movements" (
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
	"from_unit_id" uuid,
	"to_unit_id" uuid,
	"batch_id" uuid,
	"of_movement_id" uuid,
	"quantity" integer NOT NULL,
	"first_key" text NOT NULL,
	"last_key" text NOT NULL,
	"plate_id" uuid,
	"vehicle_id" uuid,
	"case_id" uuid,
	"occurred_on" date NOT NULL,
	"reason" text,
	"note" text,
	CONSTRAINT "plate_movements_kind_check" CHECK ("vehicles"."plate_movements"."kind" in ('receive', 'allocate', 'accept', 'recall', 'assign', 'retire', 'lose', 'write_off')),
	CONSTRAINT "plate_movements_quantity_check" CHECK ("vehicles"."plate_movements"."quantity" between 1 and 10000),
	CONSTRAINT "plate_movements_units_check" CHECK (("vehicles"."plate_movements"."kind" in ('allocate', 'recall')) = ("vehicles"."plate_movements"."from_unit_id" is not null and "vehicles"."plate_movements"."to_unit_id" is not null)),
	CONSTRAINT "plate_movements_batch_check" CHECK (("vehicles"."plate_movements"."kind" = 'receive') = ("vehicles"."plate_movements"."batch_id" is not null)),
	CONSTRAINT "plate_movements_accept_check" CHECK (("vehicles"."plate_movements"."kind" = 'accept') = ("vehicles"."plate_movements"."of_movement_id" is not null)),
	CONSTRAINT "plate_movements_reason_check" CHECK (("vehicles"."plate_movements"."kind" not in ('recall', 'write_off') or length("vehicles"."plate_movements"."reason") >= 10) and coalesce(length("vehicles"."plate_movements"."reason"), 0) <= 500 and coalesce(length("vehicles"."plate_movements"."note"), 0) <= 500)
);
--> statement-breakpoint
CREATE TABLE "vehicles"."plates" (
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
	"plate_key" text NOT NULL,
	"series" text NOT NULL,
	"serial" smallint NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"status_on" date NOT NULL,
	"vehicle_id" uuid,
	"case_id" uuid,
	"end_reason" text,
	"note" text,
	"last_movement_id" uuid,
	CONSTRAINT "plates_status_check" CHECK ("vehicles"."plates"."status" in ('in_stock', 'allocated', 'reserved', 'assigned', 'retired', 'void', 'lost')),
	CONSTRAINT "plates_key_check" CHECK ("vehicles"."plates"."series" ~ '^[A-Z]{3}$' and "vehicles"."plates"."serial" between 0 and 9999 and "vehicles"."plates"."plate_key" = 'ETH' || "vehicles"."plates"."series" || lpad("vehicles"."plates"."serial"::text, 4, '0')),
	CONSTRAINT "plates_vehicle_check" CHECK (("vehicles"."plates"."status" in ('assigned', 'retired') and "vehicles"."plates"."vehicle_id" is not null) or ("vehicles"."plates"."status" in ('in_stock', 'allocated', 'reserved', 'void') and "vehicles"."plates"."vehicle_id" is null) or "vehicles"."plates"."status" = 'lost'),
	CONSTRAINT "plates_case_check" CHECK ("vehicles"."plates"."status" <> 'reserved' or "vehicles"."plates"."case_id" is not null),
	CONSTRAINT "plates_end_check" CHECK (("vehicles"."plates"."end_reason" is null) = ("vehicles"."plates"."status" not in ('retired', 'void', 'lost')) and ("vehicles"."plates"."end_reason" is null or "vehicles"."plates"."end_reason" in ('exchanged', 'retired', 'transferred', 'lost', 'stolen', 'damaged', 'misprinted', 'other'))),
	CONSTRAINT "plates_note_check" CHECK (coalesce(length("vehicles"."plates"."note"), 0) <= 500)
);
--> statement-breakpoint
ALTER TABLE "vehicles"."plate_assignments" ADD COLUMN "plate_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_batches" ADD CONSTRAINT "plate_batches_receiving_unit_id_org_units_id_fk" FOREIGN KEY ("receiving_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" ADD CONSTRAINT "plate_movements_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" ADD CONSTRAINT "plate_movements_from_unit_id_org_units_id_fk" FOREIGN KEY ("from_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" ADD CONSTRAINT "plate_movements_to_unit_id_org_units_id_fk" FOREIGN KEY ("to_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" ADD CONSTRAINT "plate_movements_batch_id_plate_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "vehicles"."plate_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" ADD CONSTRAINT "plate_movements_plate_id_plates_id_fk" FOREIGN KEY ("plate_id") REFERENCES "vehicles"."plates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_movements" ADD CONSTRAINT "plate_movements_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plates" ADD CONSTRAINT "plates_holder_unit_id_org_units_id_fk" FOREIGN KEY ("holder_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plates" ADD CONSTRAINT "plates_batch_id_plate_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "vehicles"."plate_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles"."plates" ADD CONSTRAINT "plates_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plate_batches_reference_uq" ON "vehicles"."plate_batches" USING btree ("region_id","reference");--> statement-breakpoint
CREATE INDEX "plate_batches_org_path_gist" ON "vehicles"."plate_batches" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "plate_movements_org_path_gist" ON "vehicles"."plate_movements" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "plate_movements_unit_idx" ON "vehicles"."plate_movements" USING btree ("region_id","unit_id","kind");--> statement-breakpoint
CREATE INDEX "plate_movements_of_idx" ON "vehicles"."plate_movements" USING btree ("of_movement_id");--> statement-breakpoint
CREATE INDEX "plates_last_movement_idx" ON "vehicles"."plates" USING btree ("last_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plates_key_uq" ON "vehicles"."plates" USING btree ("region_id","plate_key");--> statement-breakpoint
CREATE UNIQUE INDEX "plates_serial_uq" ON "vehicles"."plates" USING btree ("region_id","series","serial");--> statement-breakpoint
CREATE INDEX "plates_holder_status_idx" ON "vehicles"."plates" USING btree ("region_id","holder_unit_id","status","series","serial");--> statement-breakpoint
CREATE INDEX "plates_holder_gist" ON "vehicles"."plates" USING gist ("holder_org_path");--> statement-breakpoint
CREATE INDEX "plates_batch_idx" ON "vehicles"."plates" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "plates_vehicle_idx" ON "vehicles"."plates" USING btree ("vehicle_id");--> statement-breakpoint
ALTER TABLE "vehicles"."plate_assignments" ADD CONSTRAINT "plate_assignments_plate_id_plates_id_fk" FOREIGN KEY ("plate_id") REFERENCES "vehicles"."plates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plate_assignments_plate_uq" ON "vehicles"."plate_assignments" USING btree ("plate_id") WHERE "vehicles"."plate_assignments"."plate_id" is not null;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_assignments" ADD CONSTRAINT "plate_assignments_stock_check" CHECK ("vehicles"."plate_assignments"."plate_id" is null or ("vehicles"."plate_assignments"."format" = 'national' and "vehicles"."plate_assignments"."source" = 'federal'));