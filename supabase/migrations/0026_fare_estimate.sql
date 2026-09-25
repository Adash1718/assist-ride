-- 0026 — the fare a rider was quoted, and what the driver earns for the ride.
--
-- Replaces the flat $19.50 placeholder on the completion screen. The app
-- could already tell a rider exactly what cancelling cost while being unable
-- to tell them what the ride cost; since round 23 every ride carries a real
-- routed distance and duration, so it can.
--
-- Stored rather than recomputed on the fly, for the same reason
-- needs_snapshot is: it's a record of what the rider was told AT BOOKING.
-- Rates will change, and a past ride must keep showing the number that was
-- quoted for it, not today's price.
--
-- Nothing here bills anyone. `fee_cents` (0016) remains the only money the
-- app actually asserts, and that's still decided server-side.

alter table public.ride_requests
  -- What the rider was quoted. Distance-dominant, and deliberately
  -- independent of the rider's needs: metering real kerb time would charge
  -- disabled riders more for the same journey, which the ADA prohibits
  -- (28 CFR 36.301(c)) and which would be a strange thing for THIS app to do.
  add column if not exists fare_estimate_cents integer,
  -- Paid to the driver on top, out of the platform's margin, for the extra
  -- work an assisted ride involves. Never added to the rider's fare.
  add column if not exists driver_premium_cents integer;

alter table public.ride_requests drop constraint if exists ride_requests_fare_range;
alter table public.ride_requests add constraint ride_requests_fare_range check (
  (fare_estimate_cents is null or fare_estimate_cents >= 0)
  and (driver_premium_cents is null or driver_premium_cents >= 0)
);

-- Both nullable: a ride whose addresses never geocoded has no route, so it
-- has no estimate either, and the screens show the trip without one rather
-- than inventing a price.
