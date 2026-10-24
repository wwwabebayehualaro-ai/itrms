CREATE TABLE "forms"."submission_values" (
	"submission_id" uuid NOT NULL,
	"ordinal" smallint DEFAULT 0 NOT NULL,
	"form_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"value_text" text,
	"value_num" double precision,
	"value_date" date,
	"value_ts" timestamp with time zone,
	"value_bool" boolean,
	CONSTRAINT "submission_values_submission_id_field_key_ordinal_pk" PRIMARY KEY("submission_id","field_key","ordinal")
);
--> statement-breakpoint
ALTER TABLE "forms"."form_definitions" ADD COLUMN "indexed_keys" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "forms"."submission_values" ADD CONSTRAINT "submission_values_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "forms"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_values_text_idx" ON "forms"."submission_values" USING btree ("form_id","field_key","value_text","submission_id") WHERE "forms"."submission_values"."value_text" is not null;--> statement-breakpoint
CREATE INDEX "submission_values_num_idx" ON "forms"."submission_values" USING btree ("form_id","field_key","value_num","submission_id") WHERE "forms"."submission_values"."value_num" is not null;--> statement-breakpoint
CREATE INDEX "submission_values_date_idx" ON "forms"."submission_values" USING btree ("form_id","field_key","value_date","submission_id") WHERE "forms"."submission_values"."value_date" is not null;--> statement-breakpoint
CREATE INDEX "submission_values_ts_idx" ON "forms"."submission_values" USING btree ("form_id","field_key","value_ts","submission_id") WHERE "forms"."submission_values"."value_ts" is not null;--> statement-breakpoint
CREATE INDEX "submission_values_bool_idx" ON "forms"."submission_values" USING btree ("form_id","field_key","value_bool","submission_id") WHERE "forms"."submission_values"."value_bool" is not null;--> statement-breakpoint
CREATE INDEX "submission_values_org_path_gist" ON "forms"."submission_values" USING gist ("org_path");