-- 0025 — who the emergency contact actually IS to the rider.
--
-- The contact list was name and phone, which leaves a driver ringing a
-- stranger with no idea how to open the conversation. "Maria Alvarez ·
-- Daughter" tells them who picked up and what they're to that person;
-- "Maria Alvarez" tells them nothing. SPEC.md §2.2 has described these as
-- name/phone/relationship since day one — the column was simply never there.
--
-- Deliberately still no address or email in what a driver sees: a relationship
-- is what makes the call work, a home address is just more of someone else's
-- personal data in a stranger's hands.

alter table public.emergency_contacts
  add column if not exists relationship text not null default '';

-- Carried through to the driver, alongside name and phone (0020). Everything
-- else about that function is unchanged: matched driver only, only at
-- 'arrived'/'in_progress', and every read still logged for the rider.
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

  if v_status not in ('arrived', 'in_progress') then
    raise exception 'emergency contacts are only available during the ride'
      using errcode = '55000';
  end if;

  if v_rider is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', ec.id, 'name', ec.name, 'phone', ec.phone, 'relationship', ec.relationship)
      order by ec.created_at
    ),
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
