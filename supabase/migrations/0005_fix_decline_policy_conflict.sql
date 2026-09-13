-- Fix: declining a ride failed with "new row violates row-level security
-- policy" (42501). Root cause: two UPDATE policies both matched the old row
-- (status = 'requested') — "driver claims a requested ride" and "driver
-- declines a requested ride" — and Postgres requires the new row to satisfy
-- EACH matching policy's own WITH CHECK, not just any one of them. The
-- claims policy's check (matched_driver_id = auth.uid()) is naturally false
-- for a decline, which doesn't set a driver — so the update was rejected
-- even though the declines policy's own check was satisfied.
--
-- Fix: widen the claims policy's check to also accept a non-claiming update
-- (status stays 'requested', no driver assigned) — i.e. exactly what a
-- decline does. Uses ALTER POLICY in place, no drop, no data touched.

alter policy "driver claims a requested ride" on public.ride_requests
  with check (matched_driver_id = auth.uid() or (status = 'requested' and matched_driver_id is null));
