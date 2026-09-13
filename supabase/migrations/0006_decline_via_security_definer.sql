-- Fix: declining a ride still failed after 0005 with "new row violates
-- row-level security policy for table ride_requests" (42501).
--
-- Real root cause (0005's diagnosis was wrong — Postgres ORs together the
-- WITH CHECKs of all permissive UPDATE policies, it doesn't require each one
-- to pass): when an UPDATE reads the table's columns (a WHERE or RETURNING
-- clause — the decline function has `where ... status = 'requested'`),
-- Postgres ALSO requires the updated row to still be visible under the
-- table's SELECT policies. A decline appends the driver to
-- declined_driver_ids, which is exactly what "available drivers read open
-- or their matched rides" hides from that driver — so the new row is
-- invisible to the very driver writing it, and the update is rejected. No
-- UPDATE-policy tweak can fix that without also making declined rides
-- visible again.
--
-- Fix: do the decline inside a SECURITY DEFINER function (same pattern as
-- is_available_driver in 0003) that makes its own authorization checks, so
-- the write doesn't go through ride_requests' RLS at all. Same name and
-- signature as 0004's version, so the app's rpc() call is unchanged.
--
-- With decline no longer a direct UPDATE, the two policy changes made only
-- to permit it are removed — both let any available driver rewrite other
-- columns (pickup, needs_snapshot, declined_driver_ids...) of any open ride
-- they didn't claim:
--   * the "driver declines a requested ride" UPDATE policy (0004) is dropped
--   * the "driver claims" check goes back to 0002's original
--     (matched_driver_id = auth.uid()), undoing 0005's widening
-- Accepting and riders cancelling are unaffected. No data is touched.

create or replace function public.decline_ride_request(p_ride_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_driver_id is distinct from auth.uid() then
    raise exception 'can only decline as yourself' using errcode = '42501';
  end if;
  if not exists (select 1 from driver_profiles where id = auth.uid()) then
    raise exception 'only drivers can decline rides' using errcode = '42501';
  end if;

  -- No-op (not an error) if the ride was claimed/cancelled in the meantime
  -- or this driver already declined it.
  update ride_requests
  set declined_driver_ids = array_append(declined_driver_ids, p_driver_id), updated_at = now()
  where id = p_ride_id
    and status = 'requested'
    and not (p_driver_id = any(declined_driver_ids));
end;
$$;

revoke execute on function public.decline_ride_request(uuid, uuid) from public, anon;
grant execute on function public.decline_ride_request(uuid, uuid) to authenticated;

drop policy if exists "driver declines a requested ride" on public.ride_requests;

alter policy "driver claims a requested ride" on public.ride_requests
  with check (matched_driver_id = auth.uid());
