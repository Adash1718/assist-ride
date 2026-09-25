-- 0027 — don't offer a ride to a driver who is absurdly far from it, and
-- widen that limit until someone can take it.
--
-- SPEC.md §4 has wanted this since the start and it was impossible without
-- geography. Round 15 already staggers offers by RANK, and round 24 put
-- distance into the ranking, but there has never been a distance CAP: a
-- driver forty miles away was eligible from the first second, just ranked
-- lower. If nobody nearer was online they'd get the offer, accept, and the
-- rider would wait an hour for a pickup they were told was on its way.
--
-- The rule here only ever DELAYS an offer; it never permanently excludes
-- anyone. Specialised drivers are scarce, and a rider in a quiet area must
-- still be matched eventually — so the radius grows with the ride's age and
-- becomes unlimited once it's been searching a few minutes. Better a distant
-- driver than no driver; better a near one if there is one.

-- Starting radius, how much it grows, and how often. Every 45 seconds — the
-- same cadence as the rank stagger (0015), so the two widen in step.
create or replace function public.offer_radius_km(p_age_seconds double precision)
returns double precision
language sql
immutable
as $$
  select 8.0 + 8.0 * floor(greatest(0, p_age_seconds) / 45.0);
$$;

-- Past this the radius stops being a filter at all: at ~5 minutes of
-- searching, anyone who can serve the ride should see it.
create or replace function public.offer_radius_unlimited_after()
returns interval language sql immutable as $$ select interval '5 minutes' $$;

-- Is this driver near enough to be offered this ride YET?
--
-- Three cases answer TRUE regardless of distance, and each matters:
--   * the ride has no pickup coordinates (its address never geocoded) —
--     there is nothing to measure against, so don't filter on it;
--   * the driver has no usable position (sharing off, or stale) — they are
--     already ranked neutrally (0024), and a filter they cannot satisfy
--     would turn declining location permission into a ban on working;
--   * the ride has been searching long enough that the radius is lifted.
create or replace function public.driver_within_offer_radius(p_driver uuid, p_ride_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_mode text;
  v_requested timestamptz;
  v_created timestamptz;
  v_started timestamptz;
  v_age double precision;
  v_km double precision;
begin
  select pickup_lat, pickup_lng, ride_mode, requested_time, created_at
    into v_lat, v_lng, v_mode, v_requested, v_created
  from ride_requests
  where id = p_ride_id;

  if not found or v_lat is null or v_lng is null then
    return true; -- nothing to measure
  end if;

  -- Age is measured from when the ride entered the SEARCH, not when it was
  -- booked: a ride scheduled for tomorrow hasn't been waiting since today.
  v_started := public.ride_search_started_at(v_mode, v_requested, v_created);
  v_age := extract(epoch from (now() - v_started));

  if now() > v_started + public.offer_radius_unlimited_after() then
    return true;
  end if;

  select public.haversine_km(dl.lat, dl.lng, v_lat, v_lng) into v_km
  from driver_locations dl
  where dl.driver_id = p_driver
    and dl.updated_at > now() - public.driver_location_max_age();

  if not found then
    return true; -- not sharing a position: never penalised for it
  end if;

  return v_km <= public.offer_radius_km(v_age);
end;
$$;

revoke execute on function public.driver_within_offer_radius(uuid, uuid) from public, anon;
grant execute on function public.driver_within_offer_radius(uuid, uuid) to authenticated;

-- Added to the drivers' SELECT policy alongside the existing conditions. A
-- driver still only ever sees a ride they can actually serve (0010), haven't
-- declined (0006), that's in its lead window (0013), and whose rank has come
-- up (0015) — this adds "and isn't miles away yet".
alter policy "available drivers read open or their matched rides" on public.ride_requests
  using (
    (
      status = 'requested'
      and public.is_available_driver(auth.uid())
      and not (auth.uid() = any(declined_driver_ids))
      and public.driver_can_serve(auth.uid(), needs_snapshot, companion_count)
      and (ride_mode = 'on_demand' or requested_time <= now() + interval '60 minutes')
      and public.driver_within_offer_radius(auth.uid(), id)
      and public.driver_offer_rank(auth.uid(), id)
          <= 1 + floor(
                extract(epoch from (now() - public.ride_search_started_at(ride_mode, requested_time, created_at))) / 45
              )
    )
    or matched_driver_id = auth.uid()
  );

-- The rider's "is anyone coming?" count (0011) has to agree with what drivers
-- can actually see, or the matching screen will cheerfully report drivers who
-- aren't being offered the ride. Same filter, same function.
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
  v_rider_id uuid;
  v_declined uuid[];
begin
  select needs_snapshot, companion_count, requested_by, rider_id, declined_driver_ids
    into v_needs, v_companions, v_requested_by, v_rider_id, v_declined
  from ride_requests
  where id = p_ride_id;

  -- Also allow the rider a ride was booked FOR to ask, not just the proxy who
  -- booked it (0017 made that distinction everywhere else).
  if not found or (v_requested_by is distinct from auth.uid() and v_rider_id is distinct from auth.uid()) then
    raise exception 'only the requester can check driver availability for this ride' using errcode = '42501';
  end if;

  return (
    select count(*)::int
    from driver_profiles dp
    where dp.is_available
      and not (dp.id = any(coalesce(v_declined, '{}'::uuid[])))
      and public.driver_can_serve(dp.id, v_needs, v_companions)
      and public.driver_within_offer_radius(dp.id, p_ride_id)
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
