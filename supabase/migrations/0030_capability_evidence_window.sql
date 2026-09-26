-- 0030 — make capability suppression genuinely recoverable, and clean up the
-- test data that proved it wasn't.
--
-- 0029 claimed recovery was possible because only the most recent 20
-- qualifying rides counted. Writing the test for it showed that was false: a
-- driver suppressed for "Comfortable assisting transfers" can no longer be
-- MATCHED to a ride needing a transfer, so they can never earn the good
-- transfer ratings that would clear it. The rolling window never rolls. It
-- was a permanent ban with no appeal, in an app with no support to appeal to
-- — and it would have done the same to a driver who had one bad month, or who
-- was rated by mistake.
--
-- The fix is to age the evidence out by TIME as well as by count. Bad ratings
-- stop counting after 60 days, so a suppression lifts on its own and the
-- driver gets another chance; if the pattern is real it re-suppresses just as
-- quickly, because the next six qualifying rides will say so.
--
-- 60 days is a judgement call: long enough that a driver can't wait out a
-- genuine problem in a week, short enough that losing this work isn't a
-- career-ending event decided by an algorithm nobody can argue with.

create or replace function public.capability_evidence_window()
returns interval language sql immutable as $$ select interval '60 days' $$;

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
      -- Only recent evidence: see the note above on why this is what makes
      -- the suppression recoverable at all.
      and f.created_at > now() - public.capability_evidence_window()
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
    limit 20
  )
  select count(rating)::int, avg(rating)::numeric from relevant where rating is not null;
$$;

revoke execute on function public.capability_evidence(uuid, text) from public, anon;
grant execute on function public.capability_evidence(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Test-data repair
-- ---------------------------------------------------------------------------
-- The suite that found the flaw left six genuine 1-star transfer ratings on
-- the shared test driver, which suppresses them for the next 60 days and
-- would break the capability-matching suites in the meantime. Feedback has no
-- DELETE policy by design (it's a record), so a migration is the only way to
-- undo it.
--
-- Scoped to 'TEST contra%' — the pickup string used by that one suite —
-- rather than every test ride. An earlier draft matched all 'TEST %' rows,
-- which would have wiped 40 of the 41 feedback rows in the project, including
-- every rating other suites have accumulated. Delete what you broke, not
-- everything that looks like it.
--
-- Worth noting what this stands in for: a REAL driver mis-rated by mistake
-- has no equivalent. There is no correction path for feedback anywhere in the
-- app, which is now more consequential than it was when feedback only moved
-- an average.
delete from public.ride_feedback f
using public.ride_requests r
where r.id = f.ride_id
  and r.pickup like 'TEST contra%';
