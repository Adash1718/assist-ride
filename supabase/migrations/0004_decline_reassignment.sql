-- Assist Ride — decline reassignment (round 6)
-- Purely additive: new column, one function, one new policy, and one
-- existing policy's condition redefined in place (ALTER POLICY, no drop).

alter table public.ride_requests add column if not exists declined_driver_ids uuid[] not null default '{}';

-- Available drivers should never see a ride they already declined resurface.
alter policy "available drivers read open or their matched rides" on public.ride_requests
  using (
    (status = 'requested' and public.is_available_driver(auth.uid()) and not (auth.uid() = any(declined_driver_ids)))
    or matched_driver_id = auth.uid()
  );

-- A driver may record a decline on any still-open ride, but this policy's
-- WITH CHECK pins status to stay 'requested' — declining can never be used
-- to sneak in an accept (that still requires the separate "claims" policy).
create policy "driver declines a requested ride" on public.ride_requests
  for update
  using (status = 'requested' and public.is_available_driver(auth.uid()))
  with check (status = 'requested');

-- Atomic array append (avoids a read-modify-write race between concurrent
-- decliners on the same ride).
create or replace function public.decline_ride_request(p_ride_id uuid, p_driver_id uuid)
returns void
language sql
as $$
  update public.ride_requests
  set declined_driver_ids = array_append(declined_driver_ids, p_driver_id), updated_at = now()
  where id = p_ride_id and status = 'requested';
$$;
