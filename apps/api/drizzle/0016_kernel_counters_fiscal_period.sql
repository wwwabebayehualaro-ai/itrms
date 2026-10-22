-- Counters whose pattern has the fiscal year restart at 1 each Ethiopian fiscal year (Hamle 1). The period only moves
-- forward, is a four-digit fiscal year (or empty: not used yet), and request code may move it only to the current fiscal
-- year; within a period the earlier rules hold (the app moves one number forward, nobody back).
ALTER TABLE "kernel"."number_counters"
    ADD CONSTRAINT "number_counters_period_check" CHECK ("period" ~ '^([0-9]{4})?$');
--> statement-breakpoint
-- The Ethiopian fiscal year of the transaction's time in Addis Ababa, named by the year it ends in. Hamle 1 is 8 July in
-- every year from 1900 to 2099 (packages/ethiopian-calendar's tests prove it), so plain date arithmetic is exact here.
CREATE FUNCTION "kernel"."current_efy"() RETURNS text
    LANGUAGE sql
    STABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT (CASE
                WHEN extract(month FROM d) * 100 + extract(day FROM d) >= 708 THEN extract(year FROM d) - 7
                ELSE extract(year FROM d) - 8
            END)::int::text
      FROM (SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date AS d) t
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "kernel"."counter_moves_by_one"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.period IS DISTINCT FROM OLD.period THEN
        IF current_user = 'itrms_app' AND NEW.period <> kernel.current_efy() THEN
            RAISE EXCEPTION 'a number counter moves only into the current fiscal year (%)', kernel.current_efy()
                USING ERRCODE = 'check_violation';
        END IF;
        IF OLD.period <> '' THEN
            IF NEW.period = '' OR NEW.period < OLD.period THEN
                RAISE EXCEPTION 'a number counter''s period never goes back (% → %)', OLD.period, NEW.period
                    USING ERRCODE = 'check_violation';
            END IF;
            -- a new fiscal year: request code starts it at 1
            IF current_user = 'itrms_app' AND NEW.last_value <> 1 THEN
                RAISE EXCEPTION 'a new period starts at number 1' USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END IF;
        -- the first use of a set-up counter: it continues from its start, as below
    END IF;
    IF NEW.last_value < OLD.last_value THEN
        RAISE EXCEPTION 'a number counter never goes back (% → %)', OLD.last_value, NEW.last_value
            USING ERRCODE = 'check_violation';
    END IF;
    IF current_user = 'itrms_app' AND NEW.last_value <> OLD.last_value + 1 THEN
        RAISE EXCEPTION 'a number counter moves by one number at a time'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER "counter_moves_by_one" ON "kernel"."number_counters";
--> statement-breakpoint
CREATE TRIGGER "counter_moves_by_one" BEFORE UPDATE OF "last_value", "period" ON "kernel"."number_counters"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."counter_moves_by_one"();
--> statement-breakpoint
GRANT UPDATE ("period") ON "kernel"."number_counters" TO itrms_app;
