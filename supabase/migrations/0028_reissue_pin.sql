-- 0028 — a way out of the PIN lockout.
--
-- Round 18 locks the pin after five wrong attempts and the error says
-- "contact support". There is no support. So five fat-fingered entries left a
-- rider and driver standing at the kerb with the ride permanently unable to
-- start — no recovery anywhere in the system, for a rider who may well have
-- planned this trip around a medical appointment. That is the worst dead end
-- in the app and it was shipped by a security measure, which is exactly how
-- these usually arrive.
--
-- The fix is a reset only the RIDER can trigger. That keeps the lockout doing
-- its job: it exists to stop the DRIVER guessing, and the driver cannot call
-- this. The rider is the person being stranded by it, they are already
-- authenticated, and they are standing right there.

create or replace function public.reissue_ride_pin(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_requested_by uuid;
  v_rider_id uuid;
  v_pin text;
begin
  select status, requested_by, rider_id into v_status, v_requested_by, v_rider_id
  from ride_requests
  where id = p_ride_id;

  -- The rider, or the proxy who booked for them (0017) — a caregiver on the
  -- phone with the driver needs this as much as the rider does.
  if not found or (v_requested_by is distinct from auth.uid() and v_rider_id is distinct from auth.uid()) then
    raise exception 'that is not your ride' using errcode = '42501';
  end if;

  -- Only while a pin could still be needed. Not before a driver exists, and
  -- not once the ride has started or ended — a new pin then would be a way to
  -- confuse a completed ride, not a way out of anything.
  if v_status not in ('matched', 'driver_en_route', 'arrived') then
    raise exception 'this ride does not need a pin right now (status: %)', v_status using errcode = '55000';
  end if;

  -- A fresh number, not a reset counter on the old one: if the old pin was
  -- overheard or half-guessed, keeping it would carry that forward.
  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');

  insert into ride_pins (ride_id, pin, attempts)
  values (p_ride_id, v_pin, 0)
  on conflict (ride_id) do update set pin = excluded.pin, attempts = 0;

  return jsonb_build_object('pin', v_pin);
end;
$$;

revoke execute on function public.reissue_ride_pin(uuid) from public, anon;
grant execute on function public.reissue_ride_pin(uuid) to authenticated;

-- And stop telling people to contact support that doesn't exist. The driver's
-- client turns this into "ask the rider for a new PIN" (lib/rideApi.ts).
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
  where rr.id = p_ride_id;

  if not found or v_driver is distinct from auth.uid() then
    raise exception 'that is not your ride' using errcode = '42501';
  end if;

  if v_status <> 'arrived' then
    raise exception 'the ride is not at pickup (status: %)', v_status using errcode = '55000';
  end if;

  if v_attempts >= max_attempts then
    raise exception 'too many incorrect pin attempts — ask the rider for a new PIN' using errcode = '55000';
  end if;

  if p_pin is distinct from v_pin then
    -- Returned, not raised: raising would undo this increment (0019).
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
