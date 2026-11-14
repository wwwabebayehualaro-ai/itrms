ALTER TABLE "forms"."form_definitions" ADD COLUMN "kind" text DEFAULT 'form' NOT NULL;--> statement-breakpoint
-- The hand-written part (task 1.13d): a definition is a form or a block, set when it is made. The app's UPDATE grant on
-- form_definitions names its columns and leaves kind out: a form never becomes a block, nor a block a form.
ALTER TABLE "forms"."form_definitions" ADD CONSTRAINT "form_definitions_kind_check" CHECK ("kind" IN ('form', 'block'));
--> statement-breakpoint
-- The impact of a block's new version (task 1.13d) finds the documents that hold a copy of it by JSON containment on their
-- fields: indexed, so a publish check reads the forms that hold one rather than every document of the region.
CREATE INDEX "form_definitions_fields_gin" ON "forms"."form_definitions" USING gin
    ((CASE WHEN jsonb_typeof("document") = 'array' THEN "document" ELSE "document" -> 'fields' END) jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX "form_versions_fields_gin" ON "forms"."form_versions" USING gin
    ((CASE WHEN jsonb_typeof("document") = 'array' THEN "document" ELSE "document" -> 'fields' END) jsonb_path_ops);
