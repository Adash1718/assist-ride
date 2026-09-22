-- Assist Ride — proxy accounts (round 17)
--
-- SPEC.md §1 puts proxy booking in scope from day one: a caregiver or family
-- member books and tracks a ride for someone else, and §2.4's requested_by
-- was always "rider themselves, or a linked proxy". The plumbing carried
-- requested_by around, but there was no way to link anyone, so every ride was
-- booked by the rider for themselves.
--
-- Linking: the rider invites by EMAIL, and the invitee accepts. The invite
-- stores the email rather than looking up an account, so nobody can use this
-- to discover which email addresses have accounts here. Accepting stamps the
-- invitee's user id on the row; the rider can revoke at any time.
--
-- Two holes this closes on the way through:
--   * a rider could NOT see a ride booked for them — every ride_requests
--     policy keys off requested_by, which is the proxy on a proxy-booked
--     ride. Riders now also see (and can cancel) rides where they are the
--     rider_id.
--   * the insert policy only checked requested_by = auth.uid(), so any
--     signed-in user could create a ride naming an arbitrary rider_id, with
--     that rider's needs snapshot attached. Booking for someone else now
--     requires an accepted link.
--
-- What a proxy may do: book, track and cancel rides for a linked rider, and
-- read that rider's profile (needs, description) because the booking screen
-- and the ride's needs_snapshot depend on it. What they may NOT do: edit the
-- rider's profile, or see their emergency/medical contacts — those stay with
-- the rider until there's a reason to widen them.
--
-- Additive: one new table, one new policy, four policies redefined in place,
-- and one function replaced. No data touched.

create table if not exists public.rider_proxies (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.rider_profiles(id) on delete cascade,
  proxy_email text not null,
  proxy_id uuid references auth.users(id) on delete set null, -- set when accepted
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (rider_id, proxy_email)
);

create index if not exists rider_proxies_proxy_id_idx on public.rider_proxies (proxy_id) where status = 'accepted';

alter table public.rider_proxies enable row level security;

-- The rider manages who may act for them.
create policy "rider reads own proxy links" on public.rider_proxies
  for select using (rider_id = auth.uid());

create policy "rider invites a proxy" on public.rider_proxies
  for insert with check (rider_id = auth.uid() and status = 'pending' and proxy_id is null);

create policy "rider updates own proxy links" on public.rider_proxies
  for update using (rider_id = auth.uid()) with check (rider_id = auth.uid());

create policy "rider deletes own proxy links" on public.rider_proxies
  for delete using (rider_id = auth.uid());

-- The invited person sees invites addressed to their email, and accepts by
-- stamping their own id on the row. They can't invite themselves: there is
-- no INSERT policy for them.
create policy "invitee reads invites addressed to them" on public.rider_proxies
  for select using (
    proxy_id = auth.uid()
    or lower(proxy_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "invitee accepts or leaves a link" on public.rider_proxies
  for update using (
    proxy_id = auth.uid()
    or lower(proxy_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (proxy_id = auth.uid() and status in ('accepted', 'revoked'));

-- A proxy needs the rider's needs and description to book and to show who
-- the ride is for. Read-only: the "rider updates own profile" policy is
-- unchanged, so a proxy can't edit someone else's profile.
create policy "accepted proxy reads the rider's profile" on public.rider_profiles
  for select using (
    exists (
      select 1 from public.rider_proxies rp
      where rp.rider_id = rider_profiles.id
        and rp.proxy_id = auth.uid()
        and rp.status = 'accepted'
    )
  );

-- Riders see and can cancel rides booked FOR them, not just ones they booked.
alter policy "rider reads own ride requests" on public.ride_requests
  using (requested_by = auth.uid() or rider_id = auth.uid());

alter policy "rider updates own ride requests" on public.ride_requests
  using (requested_by = auth.uid() or rider_id = auth.uid());

-- Booking for someone else requires an accepted link.
alter policy "rider writes own ride requests" on public.ride_requests
  with check (
    requested_by = auth.uid()
    and (
      rider_id = auth.uid()
      or exists (
        select 1 from public.rider_proxies rp
        where rp.rider_id = ride_requests.rider_id
          and rp.proxy_id = auth.uid()
          and rp.status = 'accepted'
      )
    )
  );

-- The ride's history follows the same rule as the ride itself.
alter policy "requester reads their ride's events" on public.ride_events
  using (
    exists (
      select 1 from public.ride_requests rr
      where rr.id = ride_events.ride_id
        and (rr.requested_by = auth.uid() or rr.rider_id = auth.uid())
    )
  );

-- And cancelling: the rider can cancel a ride a proxy booked for them.
-- Everything else about this function is unchanged from 0016.
create or replace function public.rider_cancel_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grace_minutes constant int := 15;
  late_fee_cents constant int := 1200;
  v_status text;
  v_requested_by uuid;
  v_rider_id uuid;
  v_matched_at timestamptz;
  v_fee int := 0;
  v_reason text := null;
begin
  select status, requested_by, rider_id into v_status, v_requested_by, v_rider_id
  from ride_requests where id = p_ride_id for update;

  if not found or (v_requested_by is distinct from auth.uid() and v_rider_id is distinct from auth.uid()) then
    raise exception 'only the requester or the rider can cancel this ride' using errcode = '42501';
  end if;

  if v_status not in ('requested', 'matched', 'driver_en_route', 'arrived') then
    raise exception 'this ride can no longer be cancelled (status: %)', v_status using errcode = '55000';
  end if;

  if v_status <> 'requested' then
    v_matched_at := public.ride_matched_at(p_ride_id);
    if v_matched_at is not null and now() > v_matched_at + make_interval(mins => grace_minutes) then
      v_fee := late_fee_cents;
      v_reason := 'late_cancellation';
    end if;
  end if;

  update ride_requests
  set status = 'cancelled', fee_cents = v_fee, fee_reason = v_reason, updated_at = now()
  where id = p_ride_id;

  return jsonb_build_object('fee_cents', v_fee, 'fee_reason', v_reason, 'grace_minutes', grace_minutes);
end;
$$;
