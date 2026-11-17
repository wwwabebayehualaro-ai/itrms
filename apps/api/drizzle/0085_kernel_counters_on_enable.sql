-- Counters set up when a service is enabled (task 1.4b4, ADR-0056). Request code (itrms_app) may insert a fresh counter: its
-- key, unit and pattern only, so it always starts at 0 with no fiscal period, and never changes a pattern. The class T
-- policy (0062) keeps the insert to the person's subtree; the API makes one through ensureCounter, an audited event (numbering.counter_set_up).
GRANT INSERT ("id", "region_id", "unit_id", "key", "pattern") ON "kernel"."number_counters" TO itrms_app;
--> statement-breakpoint
-- request code's counter numbers its own unit: its pattern begins with {unit}/, so even an insert the API never makes (an
-- injection as itrms_app) cannot plant another office's number texts (the 1.4b4 review); the owner's set-up is not limited
CREATE FUNCTION "kernel"."number_counters_app_insert"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF current_user = 'itrms_app' AND left(NEW.pattern, 7) <> '{unit}/' THEN
        RAISE EXCEPTION 'a counter request code makes begins with {unit}/' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "number_counters_app_insert" BEFORE INSERT ON "kernel"."number_counters"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."number_counters_app_insert"();
