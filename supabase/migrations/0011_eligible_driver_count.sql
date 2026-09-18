-- Assist Ride — "is anyone actually coming?" (round 11)
--
-- With 0010's capability filtering, a ride can legitimately have NO eligible
-- driver, and the rider had no way to know: the matching screen said
-- "Looking for a driver" forever. The rider can't work this out client-side —
-- driver_profiles is invisible to them under RLS, by design — so this returns
-- the count for one of their own rides.
--
-- Counted: drivers who are available, can serve this ride's needs
-- (driver_can_serve, 0010), haven't already declined it, and aren't already
-- on another ride (0007's one-active-ride rule means a busy driver can't take
-- it). Anything looser would let the app tell a rider someone can come when
-- nobody can.
--
-- Requester-only: the caller must be the ride's requested_by, so this can't
-- be used to probe driver supply for arbitrary rides. SECURITY DEFINER for
-- the same reason as driver_can_serve — it reads driver_profiles without
-- going through that table's RLS.
--
-- Purely additive: one new function. No policy or data changes.

create or replace function public.count_eligible_drivers_for_ride(p_ride_id uuid)
returns int
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_needs jsonb;
  v_companions int;
  v_requested_by uuid;
  v_declined uuid[];
begin
  select needs_snapshot, companion_count, requested_by, declined_driver_ids
    into v_needs, v_companions, v_requested_by, v_declined
  from ride_requests
  where id = p_ride_id;

  if not found or v_requested_by is distinct from auth.uid() then
    raise exception 'only the requester can check driver availability for this ride' using errcode = '42501';
  end if;

  return (
    select count(*)::int
    from driver_profiles dp
    where dp.is_available
      and not (dp.id = any(coalesce(v_declined, '{}'::uuid[])))
      and public.driver_can_serve(dp.id, v_needs, v_companions)
      and not exists (
        select 1
        from ride_requests busy
        where busy.matched_driver_id = dp.id
          and busy.status in ('matched', 'driver_en_route', 'arrived', 'in_progress')
      )
  );
end;
$$;

revoke execute on function public.count_eligible_drivers_for_ride(uuid) from public, anon;
grant execute on function public.count_eligible_drivers_for_ride(uuid) to authenticated;
