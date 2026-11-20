DROP INDEX "competency"."medical_certificates_case_uq";--> statement-breakpoint
ALTER TABLE "competency"."medical_certificates" ADD COLUMN "sequence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "competency"."medical_certificates" ADD COLUMN "report_number" text;--> statement-breakpoint
ALTER TABLE "competency"."medical_certificates" ADD COLUMN "recommendation" text;--> statement-breakpoint
ALTER TABLE "competency"."medical_certificates" ADD COLUMN "conditions_ct" "bytea";--> statement-breakpoint
CREATE UNIQUE INDEX "medical_certificates_case_sequence_uq" ON "competency"."medical_certificates" USING btree ("case_id","sequence");--> statement-breakpoint
ALTER TABLE "competency"."medical_certificates" ADD CONSTRAINT "medical_certificates_sequence_check" CHECK (sequence between 1 and 4);--> statement-breakpoint
ALTER TABLE "competency"."medical_certificates" ADD CONSTRAINT "medical_certificates_recommendation_check" CHECK (recommendation is null or recommendation in ('grant', 'grant_with_conditions', 'refuse'));--> statement-breakpoint
ALTER TABLE "competency"."medical_certificates" ADD CONSTRAINT "medical_certificates_conditions_check" CHECK (conditions_ct is null or (recommendation = 'grant_with_conditions' and octet_length(conditions_ct) > 16));--> statement-breakpoint
-- Hand-written (task 1.6a, ADR-0052, ADR-0064 §4). A renewal's report is inserted once per institution (at most three, Art. 13 of
-- Proclamation 1074/2018; after the certificate a request may have carried) and never rewritten: only the conditions it grants
-- with are added after it, as a ciphertext (the field crypto's envelope) that the audit log never holds (the table's audit policy
-- omits it, and the recommendation). The class T policies stand as they were.
GRANT UPDATE ("conditions_ct") ON "competency"."medical_certificates" TO itrms_app;
