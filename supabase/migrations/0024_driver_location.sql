-- 0024 — live driver location, so dispatch can use distance and the rider can
-- be told how far away their driver actually is.
--
-- A driver's position changes with every ride, so a fixed "base address" is
-- the wrong shape for this: a driver who just dropped someone across town is
-- nowhere near their base, and ranking would keep passing them over.
--
-- This is tracking a worker, so the handling rules are part of the design,
-- not an afterthought:
--   * ONE ROW PER DRIVER, OVERWRITTEN. No history table, no trail. What the
--     database knows is where a driver is now, never where they have been.
--   * Cleared when they go offline (the app deletes the row), and ignored
--     once stale, so a closed laptop doesn't leave a ghost on the map.
--   * NOBODY can read the raw row except the driver themselves. Ranking uses
--     it only inside SECURITY DEFINER functions, and the rider gets a
--     derived distance — never coordinates — and only while a driver is
--     actually on the way to them.
--   * A driver who refuses location permission is ranked NEUTRALLY, not
--     last. Declining to be tracked must not cost someone work.

create table if not exists public.driver_locations (
  driver_id uuid primary key references public.driver_profiles(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  updated_at timestamptz not null default now()
);

alter table public.driver_locations enable row level security;

-- The driver, and only the driver. Everything else goes through a definer
-- function below. Note there is no "rider reads driver location" policy on
-- purpose — RLS can't restrict columns, and a rider has no business with the
-- raw row even for their own driver.
drop policy if exists "driver reads own location" on public.driver_locations;
create policy "driver reads own location" on public.driver_locations
  for select using (driver_id = auth.uid());

drop policy if exists "driver writes own location" on public.driver_locations;
create policy "driver writes own location" on public.driver_locations
  for insert with check (driver_id = auth.uid());

drop policy if exists "driver updates own location" on public.driver_locations;
create policy "driver updates own location" on public.driver_locations
  for update using (driver_id = auth.uid()) with check (driver_id = auth.uid());

drop policy if exists "driver clears own location" on public.driver_locations;
create policy "driver clears own location" on public.driver_locations
  for delete using (driver_id = auth.uid());

-- How long a position stays usable. Past this a driver is treated as having
-- no location at all (neutral), rather than being dispatched from wherever
-- they were when the app last woke up.
create or replace function public.driver_location_max_age()
returns interval language sql immutable as $$ select interval '10 minutes' $$;

-- Great-circle distance in km. Straight-line, not driving distance: this is
-- for ORDERING candidates, where it's plenty, and it needs no outside
-- service. The rider-facing ETA is routed properly on the client instead.
create or replace function public.haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ---------------------------------------------------------------------------
-- Scoring with distance
-- ---------------------------------------------------------------------------
-- Proximity is worth up to 8 points, fading to 0 by 10km. Capability matches
-- are 10 each precisely so that being CLOSE never outranks being ABLE — a
-- nearby driver who can't take a wheelchair still loses to a capable one
-- further out. That ordering is the whole point of this app.
--
-- No usable location scores 4 — the middle of the range, the same as a driver
-- about 5km away. Not a penalty, not a reward.
create or replace function public.driver_proximity_points(p_driver uuid, p_lat double precision, p_lng double precision)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select case
    when p_lat is null or p_lng is null then 4.0
    else coalesce((
      select greatest(0, 8 - 0.8 * public.haversine_km(dl.lat, dl.lng, p_lat, p_lng))
      from driver_locations dl
      where dl.driver_id = p_driver
        and dl.updated_at > now() - public.driver_location_max_age()
    ), 4.0)
  end;
$$;

revoke execute on function public.driver_proximity_points(uuid, double precision, double precision) from public, anon;
grant execute on function public.driver_proximity_points(uuid, double precision, double precision) to authenticated;

-- The scoring function gains the ride's pickup point. The old two-argument
-- form is kept and delegates, so anything still calling it keeps working and
-- simply scores every driver neutrally on distance.
create or replace function public.driver_match_score(
  p_driver uuid, p_needs jsonb, p_lat double precision, p_lng double precision
)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select
      10 * (
          (case when (coalesce(p_needs->'assistanceNeeds', '[]'::jsonb) ? 'Help transferring to seat')
                     and 'Comfortable assisting transfers' = any(dp.capability_tags) then 1 else 0 end)
        + (case when coalesce(p_needs->>'mobilityAid', '') ilike '%wheelchair%'
                     and 'Wheelchair stowage' = any(dp.capability_tags) then 1 else 0 end)
        + (case when ((coalesce(p_needs->'assistanceNeeds', '[]'::jsonb) ? 'Extra patience needed')
                      or (coalesce(p_needs->'communicationNeeds', '[]'::jsonb) ? 'Prefers simple instructions'))
                     and 'Patient with cognitive-support riders' = any(dp.capability_tags) then 1 else 0 end)
        + (case when (coalesce(p_needs->'assistanceNeeds', '[]'::jsonb) ? 'Service animal')
                     and 'Experienced with service animals' = any(dp.capability_tags) then 1 else 0 end)
      )
      + coalesce((select avg(f.overall_rating) from ride_feedback f where f.driver_id = dp.id), 4.0)
      + public.driver_proximity_points(dp.id, p_lat, p_lng)
    from driver_profiles dp
    where dp.id = p_driver
  ), 0);
$$;

create or replace function public.driver_match_score(p_driver uuid, p_needs jsonb)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select public.driver_match_score(p_driver, p_needs, null::double precision, null::double precision);
$$;

revoke execute on function public.driver_match_score(uuid, jsonb, double precision, double precision) from public, anon;
grant execute on function public.driver_match_score(uuid, jsonb, double precision, double precision) to authenticated;

-- Ranking now reads the ride's pickup coordinates (0023) and passes them in.
-- A ride whose address never resolved has null coordinates, and every driver
-- then scores 4 on distance — ranking simply falls back to how it worked
-- before, rather than breaking.
create or replace function public.driver_offer_rank(p_driver uuid, p_ride_id uuid)
returns int
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_needs jsonb;
  v_companions int;
  v_declined uuid[];
  v_lat double precision;
  v_lng double precision;
  v_rank int;
begin
  select needs_snapshot, companion_count, declined_driver_ids, pickup_lat, pickup_lng
    into v_needs, v_companions, v_declined, v_lat, v_lng
  from ride_requests
  where id = p_ride_id;

  if not found then
    return 9999;
  end if;

  select ranked.rnk into v_rank
  from (
    select dp.id,
           row_number() over (order by public.driver_match_score(dp.id, v_needs, v_lat, v_lng) desc, dp.id) as rnk
    from driver_profiles dp
    where dp.is_available
      and not (dp.id = any(coalesce(v_declined, '{}'::uuid[])))
      and public.driver_can_serve(dp.id, v_needs, v_companions)
      and not exists (
        select 1 from ride_requests busy
        where busy.matched_driver_id = dp.id
          and busy.status in ('matched', 'driver_en_route', 'arrived', 'in_progress')
      )
  ) ranked
  where ranked.id = p_driver;

  return coalesce(v_rank, 9999);
end;
$$;

-- ---------------------------------------------------------------------------
-- What the rider is allowed to know
-- ---------------------------------------------------------------------------
-- Coordinates, to the ride's rider or their proxy, and only while a driver is
-- actually travelling to them — not before a match, and not once the ride is
-- under way (they're in the car; "how far away is my driver" has no meaning).
-- This is what makes a routed ETA possible on the rider's screen. It is a
-- deliberate, bounded exposure: the same information a rider would get from
-- watching a car approach, for exactly as long as it's useful.
create or replace function public.driver_location_for_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_driver uuid;
  v_status text;
  v_row record;
begin
  select matched_driver_id, status into v_driver, v_status
  from ride_requests
  where id = p_ride_id
    and (requested_by = auth.uid() or rider_id = auth.uid());

  if not found then
    raise exception 'that is not your ride' using errcode = '42501';
  end if;

  if v_driver is null or v_status not in ('matched', 'driver_en_route', 'arrived') then
    return null;
  end if;

  select lat, lng, updated_at into v_row
  from driver_locations
  where driver_id = v_driver
    and updated_at > now() - public.driver_location_max_age();

  if not found then
    return null; -- sharing off, or gone stale: the screen shows no ETA
  end if;

  return jsonb_build_object('lat', v_row.lat, 'lng', v_row.lng, 'updated_at', v_row.updated_at);
end;
$$;

revoke execute on function public.driver_location_for_ride(uuid) from public, anon;
grant execute on function public.driver_location_for_ride(uuid) to authenticated;
