-- Assist Ride — offer the best-matched driver first (round 15)
--
-- SPEC.md §3.C: filter on hard requirements, then RANK on the rest. 0010 did
-- the filtering; ranking was still "first come, first served" — whichever
-- eligible driver happened to tap first got the ride, even if another was a
-- better fit for the rider's needs.
--
-- There's no server process here to run a dispatch loop, and adding an
-- offers table would need something to expire stale offers. So the ranking
-- is expressed as staggered VISIBILITY, computed on the fly:
--
--   a ride is visible to a driver whose rank is <= 1 + floor(age / 45s)
--
-- The best match sees a new ride alone for the length of the accept window
-- (SPEC.md §4's 45 seconds), then the top two see it, then the top three,
-- and so on until everyone eligible can. No background job, no new state,
-- and it degrades to exactly today's behaviour for an older ride.
--
-- Ranking inputs, in order: how many of the driver's capability tags are
-- RELEVANT to this ride's needs, then their rating (0014). Proximity is in
-- the spec but there is no geo anywhere in this app, so it isn't used.
-- Hard requirements are already guaranteed by driver_can_serve, so the tag
-- term mostly separates drivers on the advisory needs — e.g. a driver
-- experienced with service animals is offered that ride first. Drivers with
-- no ratings score as average (4.0), not worst, so a new driver isn't buried.
--
-- "Age" is measured from when the ride entered the search, which for a
-- scheduled ride is its lead window (0013), not when it was booked.
--
-- Purely additive: three new functions, and the drivers' SELECT policy
-- redefined in place. No data touched.

create or replace function public.ride_search_started_at(p_mode text, p_requested timestamptz, p_created timestamptz)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_mode = 'scheduled' then greatest(p_created, p_requested - interval '60 minutes')
    else p_created
  end;
$$;

create or replace function public.driver_match_score(p_driver uuid, p_needs jsonb)
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
    from driver_profiles dp
    where dp.id = p_driver
  ), 0);
$$;

-- Where this driver stands among everyone who could take the ride right now
-- (available, able to serve it, hasn't declined it, not already on a ride).
-- 9999 for a driver who isn't a candidate at all, so the policy just fails.
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
  v_rank int;
begin
  select needs_snapshot, companion_count, declined_driver_ids
    into v_needs, v_companions, v_declined
  from ride_requests
  where id = p_ride_id;

  if not found then
    return 9999;
  end if;

  select ranked.rnk into v_rank
  from (
    select dp.id,
           row_number() over (order by public.driver_match_score(dp.id, v_needs) desc, dp.id) as rnk
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

revoke execute on function public.driver_match_score(uuid, jsonb) from public, anon;
revoke execute on function public.driver_offer_rank(uuid, uuid) from public, anon;
grant execute on function public.driver_match_score(uuid, jsonb) to authenticated;
grant execute on function public.driver_offer_rank(uuid, uuid) to authenticated;

alter policy "available drivers read open or their matched rides" on public.ride_requests
  using (
    (
      status = 'requested'
      and public.is_available_driver(auth.uid())
      and not (auth.uid() = any(declined_driver_ids))
      and public.driver_can_serve(auth.uid(), needs_snapshot, companion_count)
      and (ride_mode = 'on_demand' or requested_time <= now() + interval '60 minutes')
      and public.driver_offer_rank(auth.uid(), id)
          <= 1 + floor(
                extract(epoch from (now() - public.ride_search_started_at(ride_mode, requested_time, created_at))) / 45
              )
    )
    or matched_driver_id = auth.uid()
  );
