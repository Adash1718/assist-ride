-- Assist Ride — ride status event log (round 9)
--
-- Why: the tracking screen (SPEC.md §3.F) shows a timeline — requested at
-- 2:04, matched with a driver at 2:06, picked up, completed — and
-- ride_requests only keeps the CURRENT status plus updated_at, so that
-- history isn't recoverable. It also can't show a driver handing the ride
-- back before pickup (status goes matched → requested), which is exactly
-- the kind of thing whoever booked the ride needs to see afterwards.
--
-- A trigger writes the log, not the app: status changes come from several
-- paths — the driver's screens (advanceRideStatus/accept), the rider's
-- cancel, and the SECURITY DEFINER functions decline_ride_request (no
-- status change) and driver_cancel_ride — and a trigger catches all of
-- them, including any added later. Clients can read the log but never
-- write it (no INSERT/UPDATE/DELETE policies; the trigger runs as the
-- table owner), so it can't be forged or rewritten.
--
-- Purely additive: new table + index + trigger, no changes to existing
-- tables, policies or data.

create table if not exists public.ride_events (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.ride_requests(id) on delete cascade,
  status text not null,
  driver_id uuid references public.driver_profiles(id), -- who held the ride at that moment (null once handed back)
  changed_by uuid,                                      -- auth.uid() that caused it, when there was a session
  at timestamptz not null default now()
);

create index if not exists ride_events_ride_id_at_idx on public.ride_events (ride_id, at);

alter table public.ride_events enable row level security;

-- Whoever booked the ride reads its history — the rider today, a linked
-- proxy later (same requested_by check ride_requests already uses).
create policy "requester reads their ride's events" on public.ride_events
  for select using (
    exists (
      select 1 from public.ride_requests rr
      where rr.id = ride_events.ride_id and rr.requested_by = auth.uid()
    )
  );

-- The matched driver reads the history of the ride they're currently on.
create policy "matched driver reads their ride's events" on public.ride_events
  for select using (
    exists (
      select 1 from public.ride_requests rr
      where rr.id = ride_events.ride_id and rr.matched_driver_id = auth.uid()
    )
  );

create or replace function public.log_ride_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fires on insert, and on updates that actually change the status (an
  -- UPDATE ... SET status = 'matched' that changes nothing shouldn't log).
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into ride_events (ride_id, status, driver_id, changed_by)
    values (new.id, new.status, new.matched_driver_id, auth.uid());
  end if;
  return null; -- AFTER trigger; return value is ignored
end;
$$;

create or replace trigger ride_requests_log_event
  after insert or update of status on public.ride_requests
  for each row execute function public.log_ride_event();

-- Realtime so the tracking screen can append new steps as they happen.
alter publication supabase_realtime add table public.ride_events;
