-- Assist Ride — real capability matching (round 10)
--
-- Until now matching was deliberately minimal: ANY available driver saw ANY
-- 'requested' ride (see 0002's comment). That undercuts the whole premise —
-- a rider in a power wheelchair could be offered to a car with no ramp, a
-- rider needing help transferring could get a driver who never claimed that
-- capability, and companion seats were ignored entirely.
--
-- SPEC.md §3.C: filter on the hard requirements, rank on the rest. This is
-- the filter half. Ranking (capability-tag overlap, proximity, rating) needs
-- an assignment step that doesn't exist yet — today any eligible driver can
-- take any eligible ride, first come first served.
--
-- Scope decision (2026-09-17): this service targets riders with MODERATE
-- assistance needs. Severe-care transport is non-emergency medical
-- transport — different vehicles, training and regulation (see SPEC.md §5) —
-- and is explicitly not what these rules try to cover.
--
-- Hard requirements (a driver who fails one cannot SEE the ride, so they
-- can't be offered it and can't accept it):
--   * power wheelchair, or any wheelchair the rider says doesn't fold → the
--     vehicle must be ramp-equipped
--   * a folding wheelchair → ramp OR the 'Wheelchair stowage' capability
--   * 'Help transferring to seat' → 'Comfortable assisting transfers'
--   * 'Extra patience needed' or 'Prefers simple instructions' →
--     'Patient with cognitive-support riders'
--   * companion_count must fit the driver's companion_seats
--
-- Deliberately NOT filters, shown to the driver as advisories instead:
--   * 'Service animal' — in the US this is a legal obligation, not an
--     optional capability; letting drivers filter these rides out would be
--     the wrong behaviour to build in
--   * 'Hard of hearing', 'Vision impaired', 'Needs extra time' — no
--     matching driver capability exists to check them against
--
-- Purely additive: one new function, and the existing driver SELECT policy
-- gains a condition (ALTER POLICY, in place). No data is touched.

create or replace function public.driver_can_serve(p_driver uuid, p_needs jsonb, p_companions int)
returns boolean
language sql
security definer          -- reads driver_profiles without going back through its RLS
set search_path = public
stable
as $$
  -- coalesce everywhere: needs_snapshot on older rows can be '{}' or missing
  -- keys, and a null here would make the whole policy null (i.e. deny).
  select coalesce((
    select
      case
        when p_needs->>'mobilityAid' = 'Power wheelchair'
          then dp.ramp_equipped = 'Yes'
        when coalesce(p_needs->>'mobilityAid', '') ilike '%wheelchair%'
             and coalesce(p_needs->>'foldable', 'Yes') = 'No'
          then dp.ramp_equipped = 'Yes'
        when coalesce(p_needs->>'mobilityAid', '') ilike '%wheelchair%'
          then dp.ramp_equipped = 'Yes' or 'Wheelchair stowage' = any(dp.capability_tags)
        else true
      end
      and (
        not (coalesce(p_needs->'assistanceNeeds', '[]'::jsonb) ? 'Help transferring to seat')
        or 'Comfortable assisting transfers' = any(dp.capability_tags)
      )
      and (
        not (
          coalesce(p_needs->'assistanceNeeds', '[]'::jsonb) ? 'Extra patience needed'
          or coalesce(p_needs->'communicationNeeds', '[]'::jsonb) ? 'Prefers simple instructions'
        )
        or 'Patient with cognitive-support riders' = any(dp.capability_tags)
      )
      and coalesce(p_companions, 0) <= dp.companion_seats
    from driver_profiles dp
    where dp.id = p_driver
  ), false);
$$;

revoke execute on function public.driver_can_serve(uuid, jsonb, int) from public, anon;
grant execute on function public.driver_can_serve(uuid, jsonb, int) to authenticated;

-- Open rides are now only visible to drivers who can actually serve them.
-- A ride already matched to this driver stays visible regardless (the
-- second branch), so editing a profile mid-ride can't strand a driver.
alter policy "available drivers read open or their matched rides" on public.ride_requests
  using (
    (
      status = 'requested'
      and public.is_available_driver(auth.uid())
      and not (auth.uid() = any(declined_driver_ids))
      and public.driver_can_serve(auth.uid(), needs_snapshot, companion_count)
    )
    or matched_driver_id = auth.uid()
  );
