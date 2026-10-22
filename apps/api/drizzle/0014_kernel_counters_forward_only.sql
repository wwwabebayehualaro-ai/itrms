-- A number is never issued twice (architecture.md §15): request code moves a counter by exactly one at a time. Only the
-- owner (the installation's configuration, a migrated register's start) sets it otherwise, and never lower.
CREATE FUNCTION "kernel"."counter_moves_by_one"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
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
CREATE TRIGGER "counter_moves_by_one" BEFORE UPDATE OF "last_value" ON "kernel"."number_counters"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."counter_moves_by_one"();
