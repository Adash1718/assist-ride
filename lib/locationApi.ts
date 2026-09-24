import { supabase } from './supabase';

// Live driver location (migration 0024). Reported only while a driver is
// available, deleted the moment they go offline, and never readable by anyone
// but them — the rider gets a derived distance through
// `driver_location_for_ride`, not this.

// How often a position is pushed while online. Not every GPS tick: the
// browser fires those far more often than dispatch needs, and each one is a
// write. A driver crossing town moves maybe a kilometre in this window, which
// is well inside the accuracy proximity ranking needs.
export const LOCATION_PUSH_MS = 45000;

export type DriverPoint = { lat: number; lng: number; updatedAt: string };

export async function reportDriverLocation(driverId: string, lat: number, lng: number): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('driver_locations')
    .upsert({ driver_id: driverId, lat, lng, updated_at: new Date().toISOString() });
  return { error: error?.message ?? null };
}

// Called when a driver goes offline. Deletes rather than letting the row age
// out: the promise on the availability toggle is that sharing stops, and a
// row sitting there for another ten minutes isn't that.
export async function clearDriverLocation(driverId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('driver_locations').delete().eq('driver_id', driverId);
  return { error: error?.message ?? null };
}

// Where the rider's matched driver is, if they're sharing and on the way.
// Null is the ordinary case for "no ETA available" — sharing off, position
// stale, or the ride isn't at a stage where it means anything.
export async function fetchDriverLocationForRide(rideId: string): Promise<{ data: DriverPoint | null; error: string | null }> {
  const { data, error } = await supabase.rpc('driver_location_for_ride', { p_ride_id: rideId });
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: null };
  const row = data as any;
  return { data: { lat: Number(row.lat), lng: Number(row.lng), updatedAt: row.updated_at }, error: null };
}

export type LocationSharing = 'off' | 'asking' | 'on' | 'denied' | 'unsupported';

// Starts pushing this driver's position and returns a stopper. The caller
// owns the lifecycle: Driver Home starts it when going available and stops it
// when going offline (the stopper clears the stored row too).
//
// Errors are reported through `onState` rather than thrown: a driver who
// declines the permission prompt is still perfectly able to work, and is
// ranked neutrally (0024) rather than penalised.
export function startSharingLocation(
  driverId: string,
  onState: (state: LocationSharing) => void
): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onState('unsupported');
    return () => {};
  }

  let stopped = false;
  let lastPush = 0;
  let watchId: number | null = null;

  onState('asking');

  const handle = (position: GeolocationPosition) => {
    if (stopped) return;
    onState('on');
    const now = Date.now();
    if (now - lastPush < LOCATION_PUSH_MS) return; // throttle: see LOCATION_PUSH_MS
    lastPush = now;
    void reportDriverLocation(driverId, position.coords.latitude, position.coords.longitude);
  };

  const fail = (err: GeolocationPositionError) => {
    if (stopped) return;
    onState(err.code === err.PERMISSION_DENIED ? 'denied' : 'off');
  };

  watchId = navigator.geolocation.watchPosition(handle, fail, {
    enableHighAccuracy: false, // street-level is plenty, and it costs far less battery
    maximumAge: LOCATION_PUSH_MS,
    timeout: 20000,
  });

  // Closing the tab never runs a React cleanup, so without this the last
  // position would sit in the table until it was overwritten. Best-effort
  // only — the browser may kill the request before it lands, which is why
  // everything that reads a position also ignores stale ones (0024).
  const onPageHide = () => {
    void clearDriverLocation(driverId);
  };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);

  return () => {
    stopped = true;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
    onState('off');
    void clearDriverLocation(driverId);
  };
}
