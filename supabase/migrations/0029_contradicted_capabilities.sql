-- 0029 — stop matching a driver on a capability their riders say they don't
-- have.
--
-- Capability tags are self-declared and nothing checks them (round 30 at
-- least stopped the app calling them "verified"). That matters more here than
-- in most apps: a driver ticks "Comfortable assisting transfers" and the
-- matching engine sends them to exactly the riders who cannot get out of the
-- car without it. The only evidence available without a vetting pipeline is
-- what riders say afterwards — and SPEC.md §3.C has listed acting on that as
-- unbuilt since the start.
--
-- Taking work away from someone automatically deserves care, so the rule is
-- deliberately hard to trip:
--   * MEASURED ONLY ON RIDES WHERE IT MATTERED. A driver's mobility-aid
--     rating from trips where the rider had no mobility aid says nothing
--     about stowing a wheelchair. Only rides whose needs_snapshot actually
--     called for the capability count.
--   * ENOUGH EVIDENCE. Six or more such rated rides. Two unhappy riders is
--     not a pattern, and a new driver can't be knocked out by one bad day.
--   * CLEARLY BAD, not merely below average — under 2.5 out of 5.
--   * RECOVERABLE. Only the most recent 20 qualifying rides count, so a
--     driver who improves climbs back out. A permanent ban from one bad
--     stretch would be a punishment, and nobody here is able to appeal it.
--
-- The driver is TOLD (driver_contradicted_tags, surfaced on their profile).
-- Silently draining someone's work is the failure mode this project keeps
-- running into, and it would be especially cruel here.

-- Which rating speaks to which claim. Service-animal experience has no
-- corresponding question on the feedback form, and a service animal is never
-- a matching filter anyway (it's a legal obligation), so it isn't listed.
create or replace function public.capability_evidence(p_driver uuid, p_tag text)
returns table (sample_count int, average numeric)
language sql
security definer
set search_path = public
stable
as $$
  with relevant as (
    select
      case p_tag
        when 'Comfortable assisting transfers' then f.mobility_rating
        when 'Wheelchair stowage' then f.mobility_rating
        when 'Patient with cognitive-support riders' then f.patience_rating
      end as rating,
      f.created_at
    from ride_feedback f
    join ride_requests r on r.id = f.ride_id
    where f.driver_id = p_driver
      -- Only rides where this capability was actually called for.
      and case p_tag
            when 'Comfortable assisting transfers'
              then coalesce(r.needs_snapshot->'assistanceNeeds', '[]'::jsonb) ? 'Help transferring to seat'
            when 'Wheelchair stowage'
              then coalesce(r.needs_snapshot->>'mobilityAid', '') ilike '%wheelchair%'
            when 'Patient with cognitive-support riders'
              then coalesce(r.needs_snapshot->'assistanceNeeds', '[]'::jsonb) ? 'Extra patience needed'
                or coalesce(r.needs_snapshot->'communicationNeeds', '[]'::jsonb) ? 'Prefers simple instructions'
            else false
          end
    order by f.created_at desc
    limit 20   -- a rolling window, so this is recoverable
  )
  select count(rating)::int, avg(rating)::numeric from relevant where rating is not null;
$$;

revoke execute on function public.capability_evidence(uuid, text) from public, anon;
grant execute on function public.capability_evidence(uuid, text) to authenticated;

create or replace function public.capability_min_rides()
returns int language sql immutable as $$ select 6 $$;

create or replace function public.capability_min_rating()
returns numeric language sql immutable as $$ select 2.5 $$;

-- True when the riders who actually needed this capability say it isn't there.
create or replace function public.capability_contradicted(p_driver uuid, p_tag text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select e.sample_count >= public.capability_min_rides()
       and e.average < public.capability_min_rating()
    from public.capability_evidence(p_driver, p_tag) e
  ), false);
$$;

revoke execute on function public.capability_contradicted(uuid, text) from public, anon;
grant execute on function public.capability_contradicted(uuid, text) to authenticated;

-- What a driver may currently be matched on: their declared tags, minus any
-- the evidence contradicts.
create or replace function public.effective_capability_tags(p_driver uuid)
returns text[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(array_agg(t), '{}'::text[])
  from (
    select unnest(dp.capability_tags) as t
    from driver_profiles dp
    where dp.id = p_driver
  ) tags
  where not public.capability_contradicted(p_driver, t);
$$;

revoke execute on function public.effective_capability_tags(uuid) from public, anon;
grant execute on function public.effective_capability_tags(uuid) to authenticated;

-- What the driver sees about themselves: the tag, how many qualifying rides
-- it's based on, and the average. Their OWN record only — a driver cannot
-- look up anyone else's.
create or replace function public.driver_contradicted_tags()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tags text[];
  v_out jsonb := '[]'::jsonb;
  v_tag text;
  v_count int;
  v_avg numeric;
begin
  select capability_tags into v_tags from driver_profiles where id = auth.uid();
  if v_tags is null then
    return v_out;
  end if;

  foreach v_tag in array v_tags loop
    select sample_count, average into v_count, v_avg from public.capability_evidence(auth.uid(), v_tag);
    if coalesce(v_count, 0) >= public.capability_min_rides() and v_avg < public.capability_min_rating() then
      v_out := v_out || jsonb_build_object('tag', v_tag, 'rides', v_count, 'average', round(v_avg, 1));
    end if;
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.driver_contradicted_tags() from public, anon;
grant execute on function public.driver_contradicted_tags() to authenticated;

-- ---------------------------------------------------------------------------
-- Matching reads the effective tags, not the declared ones
-- ---------------------------------------------------------------------------
-- Only the two behavioural claims are affected. `ramp_equipped` is a fact
-- about a vehicle, not a skill, and a rider's rating is no evidence either
-- way — a driver either has a ramp or doesn't, so it is left alone.
create or replace function public.driver_can_serve(p_driver uuid, p_needs jsonb, p_companions int)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select
      case
        when p_needs->>'mobilityAid' = 'Power wheelchair'
          then dp.ramp_equipped = 'Yes'
        when coalesce(p_needs->>'mobilityAid', '') ilike '%wheelchair%'
             and coalesce(p_needs->>'foldable', 'Yes') = 'No'
          then dp.ramp_equipped = 'Yes'
        when coalesce(p_needs->>'mobilityAid', '') ilike '%wheelchair%'
          then dp.ramp_equipped = 'Yes' or 'Wheelchair stowage' = any(public.effective_capability_tags(dp.id))
        else true
      end
      and (
        not (coalesce(p_needs->'assistanceNeeds', '[]'::jsonb) ? 'Help transferring to seat')
        or 'Comfortable assisting transfers' = any(public.effective_capability_tags(dp.id))
      )
      and (
        not (
          coalesce(p_needs->'assistanceNeeds', '[]'::jsonb) ? 'Extra patience needed'
          or coalesce(p_needs->'communicationNeeds', '[]'::jsonb) ? 'Prefers simple instructions'
        )
        or 'Patient with cognitive-support riders' = any(public.effective_capability_tags(dp.id))
      )
      and coalesce(p_companions, 0) <= dp.companion_seats
    from driver_profiles dp
    where dp.id = p_driver
  ), false);
$$;

revoke execute on function public.driver_can_serve(uuid, jsonb, int) from public, anon;
grant execute on function public.driver_can_serve(uuid, jsonb, int) to authenticated;
