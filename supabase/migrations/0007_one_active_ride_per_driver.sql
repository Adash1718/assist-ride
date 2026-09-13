-- Database-level guard against double-booking a driver: at most one ride
-- per driver may be in an active state (matched → in_progress) at a time.
--
-- The app already prevents this in the normal flow (Driver Home redirects a
-- driver with an active ride to the active-ride screen and offers no new
-- requests), but that's a client-side check — two tabs/devices, or two
-- offers racing each other, could still let one driver claim a second ride.
-- With this index, a second claim fails with a unique violation (23505),
-- which acceptRideRequest turns into "You already have an active ride."
--
-- Purely additive: one partial unique index, no data touched.
--
-- If this fails with "could not create unique index" (a driver ALREADY has
-- two active rides), find them with:
--   select matched_driver_id, id, status, created_at from public.ride_requests
--   where status in ('matched', 'driver_en_route', 'arrived', 'in_progress')
--   order by matched_driver_id, created_at;
-- cancel the stray one(s), then re-run this.

create unique index if not exists ride_requests_one_active_ride_per_driver
  on public.ride_requests (matched_driver_id)
  where status in ('matched', 'driver_en_route', 'arrived', 'in_progress');
