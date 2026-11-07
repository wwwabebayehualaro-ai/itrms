-- Only a counter whose pattern has the fiscal year ({efy}) has a period (security review 0.26c1 R2): request code can no
-- longer start any other counter again at 1 by moving its period, which would hand out its numbers a second time. The
-- rest is 0016's function unchanged.
CREATE OR REPLACE FUNCTION "kernel"."counter_moves_by_one"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.period IS DISTINCT FROM OLD.period THEN
        IF current_user = 'itrms_app' AND NEW.pattern NOT LIKE '%{efy}%' THEN
            RAISE EXCEPTION 'only a counter numbered by fiscal year has a period'
                USING ERRCODE = 'check_violation';
        END IF;
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
