CREATE SCHEMA "parties";
--> statement-breakpoint
CREATE TABLE "kernel"."region_data_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"kek_id" text NOT NULL,
	"wrapped" "bytea" NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties"."organisation_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"organisation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"since" date,
	"until" date
);
--> statement-breakpoint
CREATE TABLE "parties"."organisations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"name" jsonb NOT NULL,
	"tin" text,
	"licence_number" text,
	"address_unit_id" uuid,
	"kebele" text,
	"house_number" text,
	"search_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties"."person_merges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"survivor_id" uuid NOT NULL,
	"duplicate_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "parties"."person_sensitive" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"person_id" uuid NOT NULL,
	"birth_date_ct" "bytea",
	"phone_ct" "bytea",
	"fin_ct" "bytea",
	"birth_date_bidx" "bytea",
	"phone_bidx" "bytea",
	"fin_bidx" "bytea",
	"merged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties"."persons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"given_name_am" text NOT NULL,
	"father_name_am" text NOT NULL,
	"grandfather_name_am" text,
	"given_name_en" text,
	"father_name_en" text,
	"grandfather_name_en" text,
	"sex" text NOT NULL,
	"birth_year" integer,
	"address_unit_id" uuid,
	"kebele" text,
	"house_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" uuid,
	"search_text" text NOT NULL,
	"name_key_am" text NOT NULL,
	"name_key_en" text,
	CONSTRAINT "persons_birth_year_check" CHECK ("parties"."persons"."birth_year" between 1900 and 2100),
	CONSTRAINT "persons_merged_check" CHECK (("parties"."persons"."status" = 'merged') = ("parties"."persons"."merged_into_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "parties"."organisation_members" ADD CONSTRAINT "organisation_members_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."organisation_members" ADD CONSTRAINT "organisation_members_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "parties"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."organisation_members" ADD CONSTRAINT "organisation_members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "parties"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."organisations" ADD CONSTRAINT "organisations_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."organisations" ADD CONSTRAINT "organisations_address_unit_id_org_units_id_fk" FOREIGN KEY ("address_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."person_merges" ADD CONSTRAINT "person_merges_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."person_merges" ADD CONSTRAINT "person_merges_survivor_id_persons_id_fk" FOREIGN KEY ("survivor_id") REFERENCES "parties"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."person_merges" ADD CONSTRAINT "person_merges_duplicate_id_persons_id_fk" FOREIGN KEY ("duplicate_id") REFERENCES "parties"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."person_sensitive" ADD CONSTRAINT "person_sensitive_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."person_sensitive" ADD CONSTRAINT "person_sensitive_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "parties"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."persons" ADD CONSTRAINT "persons_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties"."persons" ADD CONSTRAINT "persons_address_unit_id_org_units_id_fk" FOREIGN KEY ("address_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "region_data_keys_active_uq" ON "kernel"."region_data_keys" USING btree ("region_id") WHERE active;--> statement-breakpoint
CREATE INDEX "organisation_members_org_idx" ON "parties"."organisation_members" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "organisation_members_person_idx" ON "parties"."organisation_members" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_tin_uq" ON "parties"."organisations" USING btree ("region_id","tin") WHERE "parties"."organisations"."tin" is not null;--> statement-breakpoint
CREATE INDEX "organisations_search_trgm" ON "parties"."organisations" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "organisations_handling_gist" ON "parties"."organisations" USING gist ("handling_org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "person_merges_pending_uq" ON "parties"."person_merges" USING btree ("duplicate_id") WHERE "parties"."person_merges"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "person_merges_org_path_gist" ON "parties"."person_merges" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "person_sensitive_person_uq" ON "parties"."person_sensitive" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_sensitive_fin_uq" ON "parties"."person_sensitive" USING btree ("region_id","fin_bidx") WHERE "parties"."person_sensitive"."fin_bidx" is not null and not "parties"."person_sensitive"."merged";--> statement-breakpoint
CREATE INDEX "person_sensitive_phone_idx" ON "parties"."person_sensitive" USING btree ("region_id","phone_bidx");--> statement-breakpoint
CREATE INDEX "person_sensitive_birth_date_idx" ON "parties"."person_sensitive" USING btree ("region_id","birth_date_bidx");--> statement-breakpoint
CREATE INDEX "persons_search_trgm" ON "parties"."persons" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "persons_region_name_am_idx" ON "parties"."persons" USING btree ("region_id","name_key_am");--> statement-breakpoint
CREATE INDEX "persons_region_name_en_idx" ON "parties"."persons" USING btree ("region_id","name_key_en");--> statement-breakpoint
CREATE INDEX "persons_handling_gist" ON "parties"."persons" USING gist ("handling_org_path");