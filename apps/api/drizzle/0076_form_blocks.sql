ALTER TABLE "forms"."form_definitions" ADD COLUMN "kind" text DEFAULT 'form' NOT NULL;--> statement-breakpoint
-- The hand-written part (task 1.13d): a definition is a form or a block, set when it is made. The app's UPDATE grant on
-- form_definitions names its columns and leaves kind out: a form never becomes a block, nor a block a form.
ALTER TABLE "forms"."form_definitions" ADD CONSTRAINT "form_definitions_kind_check" CHECK ("kind" IN ('form', 'block'));
