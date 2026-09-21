-- Assist Ride — a real cancellation policy, and no-shows (round 16)
--
-- SPEC.md §4 decided two things that were never built:
--   * an EXTENDED grace window (longer than a typical rideshare, because
--     this audience is often booking around medical appointments) during
--     which cancelling is free; cancelling after it, or not turning up,
--     incurs a flat fee — both "business-tuning parameters, model them as
--     configurable constants"
--   * 'no_show' as a status — it's in the schema and the app's type, but
--     nothing has ever set it, so a driver who waits and leaves has no way
--     to end the ride
--
-- The rider's cancel was a direct UPDATE, so any fee would have been
-- whatever the client said it was. Both actions now go through SECURITY
-- DEFINER functions that decide server-side, using the ride_events log
-- (0009) for the times they depend on.
--
-- Tunable constants, all here:
--   grace window       15 minutes from when a driver was matched
--   late-cancel fee    $12.00
--   no-show wait       10 minutes at pickup before a driver may mark it
--   no-show fee        $15.00
-- No payments exist anywhere in this app: a fee is recorded on the ride, and
-- nothing charges anyone.
--
-- Additive: two columns (defaulted), two functions. The rider's UPDATE
-- policy is left alone, so the old path still works — but the app now calls
-- rider_cancel_ride so the fee can't be decided by the client.

alter table public.ride_requests add column if not exists fee_cents int not null default 0;
alter table public.ride_requests add column if not exists fee_reason text
  check (fee_reason is null or fee_reason in ('late_cancellation', 'no_show'));

-- When this ride was first matched to a driver, from the event log.
create or replace function public.ride_matched_at(p_ride_id uuid)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select min(at) from ride_events where ride_id = p_ride_id and status = 'matched';
$$;

-- Rider (or their proxy later) cancels. Free while still searching, or
-- within the grace window after a driver was matched; a flat fee after that.
create or replace function public.rider_cancel_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grace_minutes constant int := 15;
  late_fee_cents constant int := 1200;
  v_status text;
  v_requested_by uuid;
  v_matched_at timestamptz;
  v_fee int := 0;
  v_reason text := null;
begin
  select status, requested_by into v_status, v_requested_by
  from ride_requests where id = p_ride_id for update;

  if not found or v_requested_by is distinct from auth.uid() then
    raise exception 'only the requester can cancel this ride' using errcode = '42501';
  end if;

  if v_status not in ('requested', 'matched', 'driver_en_route', 'arrived') then
    raise exception 'this ride can no longer be cancelled (status: %)', v_status using errcode = '55000';
  end if;

  -- Never matched? Nobody was inconvenienced, so never a fee.
  if v_status <> 'requested' then
    v_matched_at := public.ride_matched_at(p_ride_id);
    if v_matched_at is not null and now() > v_matched_at + make_interval(mins => grace_minutes) then
      v_fee := late_fee_cents;
      v_reason := 'late_cancellation';
    end if;
  end if;

  update ride_requests
  set status = 'cancelled', fee_cents = v_fee, fee_reason = v_reason, updated_at = now()
  where id = p_ride_id;

  return jsonb_build_object('fee_cents', v_fee, 'fee_reason', v_reason, 'grace_minutes', grace_minutes);
end;
$$;

-- The driver waited at pickup and nobody came. Only from 'arrived', only
-- after a real wait, and only by the driver who is actually on the ride.
create or replace function public.mark_no_show(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wait_minutes constant int := 10;
  no_show_fee_cents constant int := 1500;
  v_status text;
  v_driver uuid;
  v_arrived_at timestamptz;
begin
  select status, matched_driver_id into v_status, v_driver
  from ride_requests where id = p_ride_id for update;

  if not found or v_driver is distinct from auth.uid() then
    raise exception 'only the matched driver can mark a no-show' using errcode = '42501';
  end if;

  if v_status <> 'arrived' then
    raise exception 'a no-show can only be marked after arriving at pickup (status: %)', v_status using errcode = '55000';
  end if;

  select max(at) into v_arrived_at from ride_events where ride_id = p_ride_id and status = 'arrived';
  if v_arrived_at is null or now() < v_arrived_at + make_interval(mins => wait_minutes) then
    raise exception 'wait % minutes at pickup before marking a no-show', wait_minutes using errcode = '55000';
  end if;

  update ride_requests
  set status = 'no_show', fee_cents = no_show_fee_cents, fee_reason = 'no_show', updated_at = now()
  where id = p_ride_id;

  return jsonb_build_object('fee_cents', no_show_fee_cents, 'fee_reason', 'no_show', 'waited_minutes', wait_minutes);
end;
$$;

revoke execute on function public.rider_cancel_ride(uuid) from public, anon;
revoke execute on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.rider_cancel_ride(uuid) to authenticated;
grant execute on function public.mark_no_show(uuid) to authenticated;

-- ride_matched_at stays internal to the two functions above: it's only a
-- helper, and granting it would tell any signed-in user whether a given ride
-- id was matched and when. The app derives the same thing for its own rides
-- from the ride_events log, which RLS already scopes correctly.
revoke execute on function public.ride_matched_at(uuid) from public, anon, authenticated;
