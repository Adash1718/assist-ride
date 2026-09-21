-- Assist Ride — scheduled rides wait their turn (round 13)
--
-- A ride booked for tomorrow at 3pm was inserted as 'requested' and offered
-- to drivers immediately: they got a 45-second accept window for a ride they
-- couldn't start for a day, and the rider's screen behaved as though someone
-- was on the way. requested_time was stored and never read.
--
-- A scheduled ride now enters the search LEAD_MINUTES before its requested
-- time (60 minutes — long enough for a driver to plan around it, short enough
-- that it isn't cluttering the feed all day). On-demand rides are unaffected.
--
-- Enforced in the same drivers' SELECT policy as 0010's capability filter, so
-- the catch-up query, the Realtime feed and accept all agree: before that
-- window the ride simply isn't visible to drivers, and can't be accepted.
--
-- Knock-on effect worth knowing (handled in the app, not here): a ride
-- becoming eligible is the passage of time, not a row change, so Realtime has
-- nothing to publish at that moment. Driver Home re-runs its catch-up query
-- periodically while available so a maturing ride still gets offered.
--
-- Purely additive: one existing policy's condition, redefined in place. No
-- data touched.

alter policy "available drivers read open or their matched rides" on public.ride_requests
  using (
    (
      status = 'requested'
      and public.is_available_driver(auth.uid())
      and not (auth.uid() = any(declined_driver_ids))
      and public.driver_can_serve(auth.uid(), needs_snapshot, companion_count)
      and (ride_mode = 'on_demand' or requested_time <= now() + interval '60 minutes')
    )
    or matched_driver_id = auth.uid()
  );
