-- Fix: infinite recursion between driver_profiles and ride_requests RLS
-- policies. 0002 introduced a cycle — a driver_profiles policy queries
-- ride_requests, whose own policy queries driver_profiles back, which
-- Postgres detects as recursion (error 42P17) rather than looping forever.
--
-- Fix: the availability check moves into a SECURITY DEFINER function, which
-- reads driver_profiles WITHOUT going back through its RLS policies —
-- breaking the cycle. Uses ALTER POLICY to redefine the condition in place
-- (no drop) — this only replaces one policy's definition with an
-- equivalent, non-recursive one; no data is touched.

create or replace function public.is_available_driver(check_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_available from public.driver_profiles where id = check_id), false);
$$;

alter policy "available drivers read open or their matched rides" on public.ride_requests
  using (
    (status = 'requested' and public.is_available_driver(auth.uid()))
    or matched_driver_id = auth.uid()
  );
