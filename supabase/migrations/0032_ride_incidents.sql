-- 0032 — reporting that something went wrong, with a consequence attached.
--
-- Until now the only way to say anything about a ride was a post-ride star
-- rating: no way to report being handled roughly, left at the kerb, spoken to
-- badly, or anything else that isn't a number out of five. For a service
-- whose riders are disproportionately vulnerable to exactly those things,
-- that's the wrong last word.
--
-- The hard part isn't the form, it's making the report MEAN something. This
-- app has no support desk and no admin — so a "we'll review this" screen
-- would be the same empty promise as the "contact support" that stranded
-- people at the kerb until round 28. What the app CAN do without a human is
-- guarantee the pairing never happens again, and that is what it promises:
--
--   * reporting a driver permanently blocks that driver from being matched
--     to that rider's future rides. Enforced in the drivers' SELECT policy,
--     so it is not a preference the client can forget;
--   * the report is kept as a record;
--   * the driver is NOT told who reported them, and cannot read reports at
--     all. A rider who fears the ride home being worse for having complained
--     will not complain, and that silence is the real failure mode here.
--
-- Deliberately NOT built: automatic suspension on N reports. Removing a
-- driver's livelihood on unreviewed accusations needs a human, and inventing
-- a fake one would be worse than admitting there isn't one.

create table if not exists public.ride_incidents (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.ride_requests(id) on delete cascade,
  -- Who filed it: the rider, or the proxy who booked for them.
  reported_by uuid not null,
  rider_id uuid not null references public.rider_profiles(id) on delete cascade,
  driver_id uuid not null references public.driver_profiles(id) on delete cascade,
  category text not null check (category in ('unsafe_driving', 'rough_handling', 'rude_or_dismissive', 'left_stranded', 'assistance_refused', 'other')),
  details text not null default '' check (length(details) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists ride_incidents_rider_driver_idx on public.ride_incidents (rider_id, driver_id);

alter table public.ride_incidents enable row level security;

-- Only the person who filed it, or the rider it concerns, may read it. There
-- is deliberately no policy for drivers: a report must never be traceable
-- back to the rider who made it.
drop policy if exists "reporter and rider read incidents" on public.ride_incidents;
create policy "reporter and rider read incidents" on public.ride_incidents
  for select using (reported_by = auth.uid() or rider_id = auth.uid());

-- Filed against a real ride of yours, naming the driver who actually did it.
drop policy if exists "rider files incident on their own ride" on public.ride_incidents;
create policy "rider files incident on their own ride" on public.ride_incidents
  for insert with check (
    reported_by = auth.uid()
    and exists (
      select 1 from ride_requests rr
      where rr.id = ride_incidents.ride_id
        and (rr.requested_by = auth.uid() or rr.rider_id = auth.uid())
        and rr.rider_id = ride_incidents.rider_id
        and rr.matched_driver_id = ride_incidents.driver_id
    )
  );

-- No UPDATE or DELETE: a report is a record of what someone said happened.
-- (Unlike a rating, it does not decide anything automatically beyond the
-- block, so there is no mis-tap to undo — and withdrawing one silently would
-- be a way to pressure someone into withdrawing it.)

-- ---------------------------------------------------------------------------
-- The consequence
-- ---------------------------------------------------------------------------
create or replace function public.rider_blocked_driver(p_rider uuid, p_driver uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from ride_incidents i
    where i.rider_id = p_rider and i.driver_id = p_driver
  );
$$;

revoke execute on function public.rider_blocked_driver(uuid, uuid) from public, anon;
grant execute on function public.rider_blocked_driver(uuid, uuid) to authenticated;

-- Added to the drivers' SELECT policy. A reported driver simply never sees
-- that rider's future rides again — they are not told why, and the rider does
-- not have to do anything else.
alter policy "available drivers read open or their matched rides" on public.ride_requests
  using (
    (
      status = 'requested'
      and public.is_available_driver(auth.uid())
      and not (auth.uid() = any(declined_driver_ids))
      and not public.rider_blocked_driver(rider_id, auth.uid())
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

-- And the rider's "is anyone coming?" count must agree, or the matching
-- screen would count a driver who can no longer be offered the ride.
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

  if not found or (v_requested_by is distinct from auth.uid() and v_rider_id is distinct from auth.uid()) then
    raise exception 'only the requester can check driver availability for this ride' using errcode = '42501';
  end if;

  return (
    select count(*)::int
    from driver_profiles dp
    where dp.is_available
      and not (dp.id = any(coalesce(v_declined, '{}'::uuid[])))
      and not public.rider_blocked_driver(v_rider_id, dp.id)
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
