-- Assist Ride — driver cancel before pickup (round 8)
--
-- A driver who can't make a ride they accepted hands it back instead of
-- ending it: the ride goes back into the search (status 'requested', no
-- matched driver) and this driver is added to declined_driver_ids so they
-- aren't offered it again. A rider heading to a medical appointment keeps
-- their booking and just gets a new driver — no rebooking.
--
-- SECURITY DEFINER with its own checks (same pattern as
-- decline_ride_request in 0006), because RLS can't express this as a plain
-- UPDATE: the driver's own claims policy requires matched_driver_id =
-- auth.uid() on the new row, and the handed-back row is (by design)
-- invisible to that driver under the SELECT policy.
--
-- Checks, with the row locked so a concurrent rider cancel or status change
-- can't slip in between the checks and the update:
--   * caller is the ride's matched driver (otherwise 42501 — also for a
--     ride that doesn't exist, so the error doesn't reveal which ids exist)
--   * the ride is still before pickup: matched, driver_en_route or arrived
--     (otherwise 55000). This also means a cancelled or completed ride can
--     never be revived into the search by a stale driver screen.
--
-- Purely additive: one new function, no policy or data changes.

create or replace function public.driver_cancel_ride(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_driver uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select status, matched_driver_id into v_status, v_driver
  from ride_requests
  where id = p_ride_id
  for update;

  if not found or v_driver is distinct from auth.uid() then
    raise exception 'only the matched driver can cancel this ride' using errcode = '42501';
  end if;

  if v_status not in ('matched', 'driver_en_route', 'arrived') then
    raise exception 'ride can no longer be cancelled by the driver (status: %)', v_status using errcode = '55000';
  end if;

  update ride_requests
  set status = 'requested',
      matched_driver_id = null,
      declined_driver_ids = case
        when auth.uid() = any(declined_driver_ids) then declined_driver_ids
        else array_append(declined_driver_ids, auth.uid())
      end,
      updated_at = now()
  where id = p_ride_id;
end;
$$;

revoke execute on function public.driver_cancel_ride(uuid) from public, anon;
grant execute on function public.driver_cancel_ride(uuid) to authenticated;
