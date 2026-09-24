-- 0023 — real coordinates and a real route for a ride.
--
-- Until now the app had no geography at all: no distance, no ETA, and an
-- offer ranking (0015) with no notion of who is nearby. The tracking screen
-- used to show "~8 min", which was invented, and was deleted for that reason
-- in round 17. This is what it takes to say something true instead.
--
-- Everything here is NULLABLE on purpose. Geocoding is a best-effort call to
-- an outside service; if it fails, the booking must still go through. A ride
-- with no coordinates is normal and every screen has to cope with it — the
-- rule from round 17 stands, better to show nothing than to make a number up.

alter table public.ride_requests
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists dropoff_lat double precision,
  add column if not exists dropoff_lng double precision,
  -- What the router said when the ride was booked: metres and seconds for
  -- the pickup → dropoff leg. Cached rather than re-fetched, so the trip
  -- length shown to the rider can't drift between screens, and so an outside
  -- service being down doesn't blank out a ride already in progress.
  add column if not exists route_meters integer,
  add column if not exists route_seconds integer,
  -- Which address strings the coordinates belong to. If a ride is ever
  -- rescheduled or re-addressed, stale coordinates are worse than none, and
  -- this is what lets a reader tell.
  add column if not exists geo_pickup_label text,
  add column if not exists geo_dropoff_label text,
  add column if not exists geocoded_at timestamptz;

-- Sanity bounds. These are cheap, and a transposed lat/lng (a classic) shows
-- up here rather than as a driver being sent to the wrong hemisphere.
alter table public.ride_requests drop constraint if exists ride_requests_geo_range;
alter table public.ride_requests add constraint ride_requests_geo_range check (
  (pickup_lat is null or pickup_lat between -90 and 90)
  and (dropoff_lat is null or dropoff_lat between -90 and 90)
  and (pickup_lng is null or pickup_lng between -180 and 180)
  and (dropoff_lng is null or dropoff_lng between -180 and 180)
  and (route_meters is null or route_meters >= 0)
  and (route_seconds is null or route_seconds >= 0)
);

-- No RLS changes needed: these are columns on ride_requests, so they follow
-- the policies already there — the rider and their proxy see their own ride,
-- and a driver sees a ride only while it is offerable to them or theirs
-- (0010/0015/0018). Worth stating plainly, though: a pickup coordinate is
-- roughly someone's home address, and it is readable by any driver the ride
-- is currently being OFFERED to, not only the one who takes it. That is the
-- same exposure the pickup address string has always had.
