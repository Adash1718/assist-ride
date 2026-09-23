-- Assist Ride — make the pin attempt limit actually count (round 19)
--
-- 0018 added a five-attempt lock to start_ride_with_pin, and it never
-- worked: the function incremented ride_pins.attempts and then raised, and
-- raising rolls the whole statement back — including the increment. The
-- counter sat at 0 forever, so the lock never engaged. Caught by the test
-- for 0018, which tried six wrong pins and got the same answer every time.
--
-- Fix: a wrong pin is an ordinary outcome, not an error. The function now
-- RETURNS a result for it, which lets the increment commit. Genuine errors
-- (not your ride, wrong status, locked out) still raise, because nothing
-- needs to be written in those cases.
--
-- Returns: {"started": true} on success, or
--          {"started": false, "reason": "pin_mismatch", "attempts_left": N}
--
-- Additive: replaces one function. No schema or data changes.

create or replace function public.start_ride_with_pin(p_ride_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  max_attempts constant int := 5;
  v_status text;
  v_driver uuid;
  v_pin text;
  v_attempts int;
begin
  select rr.status, rr.matched_driver_id, rp.pin, rp.attempts
    into v_status, v_driver, v_pin, v_attempts
  from ride_requests rr
  left join ride_pins rp on rp.ride_id = rr.id
  where rr.id = p_ride_id
  for update of rr;

  if not found or v_driver is distinct from auth.uid() then
    raise exception 'only the matched driver can start this ride' using errcode = '42501';
  end if;

  if v_status <> 'arrived' then
    raise exception 'the ride must be at pickup to start (status: %)', v_status using errcode = '55000';
  end if;

  if v_pin is null then
    raise exception 'this ride has no pin on file' using errcode = '55000';
  end if;

  if v_attempts >= max_attempts then
    raise exception 'too many incorrect pin attempts — contact support' using errcode = '55000';
  end if;

  if p_pin is distinct from v_pin then
    -- Returned, not raised: raising would undo this increment.
    update ride_pins set attempts = attempts + 1 where ride_id = p_ride_id;
    return jsonb_build_object(
      'started', false,
      'reason', 'pin_mismatch',
      'attempts_left', greatest(0, max_attempts - (v_attempts + 1))
    );
  end if;

  update ride_requests set status = 'in_progress', updated_at = now() where id = p_ride_id;
  return jsonb_build_object('started', true);
end;
$$;
