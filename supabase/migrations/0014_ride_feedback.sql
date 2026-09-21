-- Assist Ride — post-ride feedback that actually goes somewhere (round 14)
--
-- complete.tsx has been collecting three specific ratings, an overall rating
-- and a comment since round 0 and writing them nowhere. SPEC.md §2.6 wants
-- this feedback tied to the driver's assistance capability tags so drivers
-- who tick the boxes without doing the work get filtered out over time; none
-- of that can start until the answers are stored.
--
-- Shape: one row per ride (ride_id is the primary key, so a second submit
-- fails with 23505 in the database rather than relying on the screen), the
-- three ratings plus overall, and an optional comment.
--
-- Who can do what:
--   * the requester writes their own ride's feedback, and only once the ride
--     is 'completed' — and driver_id must be the ride's actual matched
--     driver, so feedback can't be pinned on someone else
--   * the requester reads their own feedback back (that's how the screen
--     knows a ride was already rated)
--   * no UPDATE or DELETE policies: submitted feedback is immutable
--   * drivers CANNOT read rows at all — no policy grants it. A rider's
--     comment on a ride a driver just did would identify them. Drivers get
--     only their own aggregate, via my_driver_rating() below.
--
-- Purely additive: new table + policies + one function. No existing policy
-- or data is touched.

create table if not exists public.ride_feedback (
  ride_id uuid primary key references public.ride_requests(id) on delete cascade,
  rider_id uuid not null references auth.users(id) on delete cascade,
  driver_id uuid not null references public.driver_profiles(id),
  mobility_rating int not null check (mobility_rating between 1 and 5),
  patience_rating int not null check (patience_rating between 1 and 5),
  vehicle_rating int not null check (vehicle_rating between 1 and 5),
  overall_rating int not null check (overall_rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists ride_feedback_driver_id_idx on public.ride_feedback (driver_id);

alter table public.ride_feedback enable row level security;

create policy "requester writes feedback on their completed ride" on public.ride_feedback
  for insert with check (
    rider_id = auth.uid()
    and exists (
      select 1 from public.ride_requests rr
      where rr.id = ride_feedback.ride_id
        and rr.requested_by = auth.uid()
        and rr.status = 'completed'
        and rr.matched_driver_id = ride_feedback.driver_id
    )
  );

create policy "requester reads their own feedback" on public.ride_feedback
  for select using (rider_id = auth.uid());

-- A driver's own rating, and nothing else: no argument to pass, so there's
-- no other driver to ask about. Returns nulls (not zeros) when there's no
-- feedback yet, so the app can say "no ratings yet" instead of "0.0".
create or replace function public.my_driver_rating()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'count', count(*),
    'overall', round(avg(overall_rating)::numeric, 1),
    'mobility', round(avg(mobility_rating)::numeric, 1),
    'patience', round(avg(patience_rating)::numeric, 1),
    'vehicle', round(avg(vehicle_rating)::numeric, 1)
  )
  from ride_feedback
  where driver_id = auth.uid();
$$;

revoke execute on function public.my_driver_rating() from public, anon;
grant execute on function public.my_driver_rating() to authenticated;
