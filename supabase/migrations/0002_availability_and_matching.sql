-- Assist Ride — driver availability + real matching wiring (round 5)
-- Run this in the SQL Editor same as 0001 — it only adds to what's there.

-- ---------------------------------------------------------------------------
-- Driver availability (the Driver Home toggle now persists here instead of
-- just local state)
-- ---------------------------------------------------------------------------
alter table public.driver_profiles add column if not exists is_available boolean not null default false;

-- ---------------------------------------------------------------------------
-- ride_requests: let available drivers see open requests, and let a driver
-- claim ("accept") one. Everything a driver needs to evaluate a request
-- (needs, description) lives in needs_snapshot on the row itself, so no
-- separate grant to read rider_profiles is needed.
-- (The rider-reads-own-rows policy from 0001_init.sql already covers riders
-- — nothing to change there, so this migration only adds new policies.)
-- ---------------------------------------------------------------------------
create policy "available drivers read open or their matched rides" on public.ride_requests
  for select using (
    (status = 'requested' and exists (
      select 1 from public.driver_profiles dp where dp.id = auth.uid() and dp.is_available = true
    ))
    or matched_driver_id = auth.uid()
  );

create policy "driver claims a requested ride" on public.ride_requests
  for update
  using (status = 'requested' or matched_driver_id = auth.uid())
  with check (matched_driver_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Once matched, the rider needs to read that driver's public profile fields
-- (name, vehicle, capability tags) for the "Driver On The Way" screen.
-- ---------------------------------------------------------------------------
create policy "rider reads their matched driver's profile" on public.driver_profiles
  for select using (
    exists (
      select 1 from public.ride_requests rr
      where rr.matched_driver_id = driver_profiles.id
      and rr.requested_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime: both sides need live updates — a driver sees a new request the
-- moment it's created, a rider sees the moment a driver accepts.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.ride_requests;
