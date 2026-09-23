-- 0020 — the driver can reach the rider's emergency contacts during the ride.
--
-- Why this exists: the assistance this app is built around means a rider may
-- become unresponsive with a driver standing next to them, and "call the app's
-- support line and wait" is the wrong answer in that moment.
--
-- The cost is real: this hands a stranger a family member's phone number. So
-- the grant is as narrow as it can be and still be useful:
--   * only the driver matched to the ride, never any other driver;
--   * only while that driver is physically with the rider — 'arrived' and
--     'in_progress'. Not while driving over, and not once the ride ends;
--   * read-only, and only name and phone — not the contact's home address or
--     email, which the driver has no use for;
--   * every read is logged, so the rider can see who looked and when.
--
-- Note this does NOT widen proxy access: 0017 deliberately keeps emergency
-- contacts away from caregivers who can book, and the People screen promises
-- exactly that. Drivers are a separate grant with a separate justification.

-- ---------------------------------------------------------------------------
-- 1. The access log
-- ---------------------------------------------------------------------------
create table if not exists public.emergency_contact_access (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.ride_requests(id) on delete cascade,
  driver_id uuid not null references public.driver_profiles(id) on delete cascade,
  rider_id uuid not null references public.rider_profiles(id) on delete cascade,
  viewed_at timestamptz not null default now()
);

create index if not exists emergency_contact_access_rider_idx
  on public.emergency_contact_access (rider_id, viewed_at desc);

alter table public.emergency_contact_access enable row level security;

-- The rider can read their own access history. Nobody writes through the API:
-- rows come from the definer function below, which is the only writer.
drop policy if exists "rider reads own emergency access log" on public.emergency_contact_access;
create policy "rider reads own emergency access log" on public.emergency_contact_access
  for select using (rider_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. The read itself
-- ---------------------------------------------------------------------------
-- Volatile, not stable: it writes the audit row as a side effect.
create or replace function public.ride_emergency_contacts(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider uuid;
  v_status text;
  v_contacts jsonb;
begin
  select rr.rider_id, rr.status into v_rider, v_status
  from ride_requests rr
  where rr.id = p_ride_id
    and rr.matched_driver_id = auth.uid();

  if not found then
    raise exception 'that is not your ride' using errcode = '42501';
  end if;

  -- Outside the pickup-to-dropoff window this is simply not the driver's
  -- business, including after the ride they just finished.
  if v_status not in ('arrived', 'in_progress') then
    raise exception 'emergency contacts are only available during the ride'
      using errcode = '55000';
  end if;

  if v_rider is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', ec.id, 'name', ec.name, 'phone', ec.phone)
      order by ec.created_at),
    '[]'::jsonb
  )
  into v_contacts
  from emergency_contacts ec
  where ec.rider_id = v_rider;

  insert into emergency_contact_access (ride_id, driver_id, rider_id)
  values (p_ride_id, auth.uid(), v_rider);

  return v_contacts;
end;
$$;

revoke execute on function public.ride_emergency_contacts(uuid) from public, anon;
grant execute on function public.ride_emergency_contacts(uuid) to authenticated;
