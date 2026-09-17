import { useEffect, useState } from 'react';
import { fetchRideRequest, RideRequestData, subscribeToRide } from './rideApi';

// One ride kept current from two sources: a fetch (the state from before the
// subscription went live) and the Realtime subscription. Live events arrive
// in commit order, so once one has been applied it wins and a slower fetch
// result is dropped. ("Furthest status wins" doesn't work: a driver cancel
// moves a ride back from matched/arrived to 'requested'.)
//
// Realtime only delivers changes the viewer can still SELECT afterwards —
// always true for the rider's own ride and for the matched driver while
// matched, but not for a driver looking at an open offer (see incoming.tsx).
export function useLiveRide(rideId: string | undefined) {
  const [ride, setRide] = useState<RideRequestData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    let gotLive = false;
    // Subscribe before fetching so an update landing in between isn't lost.
    const unsubscribe = subscribeToRide(rideId, (updated) => {
      gotLive = true;
      setRide(updated);
    });
    (async () => {
      const { data } = await fetchRideRequest(rideId);
      if (cancelled) return;
      if (!gotLive) setRide(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [rideId]);

  return { ride, loading, setRide };
}
