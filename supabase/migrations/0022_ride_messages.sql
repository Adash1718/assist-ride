-- 0022 — a message thread per ride, so the rider and driver can reach each
-- other without exchanging phone numbers.
--
-- Why messaging rather than a masked phone call: this app's riders include
-- people who are hard of hearing, need extra time, or prefer simple written
-- instructions (SPEC.md §2.2). A phone call is the one channel several of
-- them can't use. Text also leaves a record of what was agreed at the curb
-- ("I'm at the side entrance"), which a call doesn't — and it needs no
-- third-party telephony to be real.
--
-- Who can talk: the matched driver, the rider, and the proxy who booked
-- (§2.1) — a caregiver arranging the pickup is exactly who a driver may need.
-- Reading stays available after the ride for everyone's records; SENDING
-- stops when the ride ends, so a completed ride can't be reopened as a chat.

create table if not exists public.ride_messages (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.ride_requests(id) on delete cascade,
  sender_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists ride_messages_ride_idx on public.ride_messages (ride_id, created_at);

alter table public.ride_messages enable row level security;

-- Participants of a ride, as one place both policies can agree on.
-- SECURITY DEFINER for the same reason as is_available_driver (0002): a
-- policy on ride_messages that reads ride_requests, whose own policies read
-- other tables, is how 42P17 recursion starts.
create or replace function public.can_talk_on_ride(p_ride_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from ride_requests rr
    where rr.id = p_ride_id
      and (rr.requested_by = auth.uid() or rr.rider_id = auth.uid() or rr.matched_driver_id = auth.uid())
  );
$$;

revoke execute on function public.can_talk_on_ride(uuid) from public, anon;
grant execute on function public.can_talk_on_ride(uuid) to authenticated;

-- Still talkable-to: the ride is matched and hasn't ended.
create or replace function public.ride_accepts_messages(p_ride_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from ride_requests rr
    where rr.id = p_ride_id
      and rr.status in ('matched', 'driver_en_route', 'arrived', 'in_progress')
  );
$$;

revoke execute on function public.ride_accepts_messages(uuid) from public, anon;
grant execute on function public.ride_accepts_messages(uuid) to authenticated;

drop policy if exists "participants read ride messages" on public.ride_messages;
create policy "participants read ride messages" on public.ride_messages
  for select using (public.can_talk_on_ride(ride_id));

-- sender_id is pinned to auth.uid() by the policy itself, so a client can't
-- post as the other party no matter what it puts in the row.
drop policy if exists "participants send ride messages" on public.ride_messages;
create policy "participants send ride messages" on public.ride_messages
  for insert with check (
    sender_id = auth.uid()
    and public.can_talk_on_ride(ride_id)
    and public.ride_accepts_messages(ride_id)
  );

-- Deliberately no UPDATE or DELETE policies: messages are a record of what
-- was said. Nobody edits or unsends, the same reasoning as ride_feedback
-- (0014) and ride_events (0009).

-- Guarded so the whole file can be run twice without error: everything above
-- is `if not exists` / `or replace`, but adding a table to a publication a
-- second time raises.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ride_messages'
  ) then
    alter publication supabase_realtime add table public.ride_messages;
  end if;
end
$$;
