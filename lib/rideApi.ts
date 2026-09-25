import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { GeoPoint, RouteInfo } from './geoApi';
import { driverServicePremiumCents, riderFareCents } from './fare';
import { DriverProfileData, RiderProfileData } from '../contexts/ProfileContext';

// Real ride-request wiring (SPEC.md §2.4, supabase/migrations/0002_*.sql).
// Which open rides a driver may see isn't decided in this file: the drivers'
// SELECT policy calls driver_can_serve() (0010), so every query and
// subscription here is already filtered to rides they can actually serve —
// ramp/stowage for wheelchairs, transfers, cognitive support, companion
// seats (SPEC.md §3.C2). Ranking between eligible drivers isn't built:
// first come, first served.

export type RideStatus =
  | 'requested'
  | 'matched'
  | 'driver_en_route'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

// A driver with a ride in one of these states is busy: Driver Home sends
// them to the active-ride screen and offers no new requests (and migration
// 0007 enforces one such ride per driver in the database).
export const ACTIVE_RIDE_STATUSES: RideStatus[] = ['matched', 'driver_en_route', 'arrived', 'in_progress'];

// Matched but not yet picked up — the window in which the rider can cancel
// and the driver can hand the ride back (driverCancelRide).
export const PRE_PICKUP_STATUSES: RideStatus[] = ['matched', 'driver_en_route', 'arrived'];

// A rider's ride that's still going — searching or matched through riding.
// Rider Home sends a rider with one of these straight to it.
export const OPEN_RIDE_STATUSES: RideStatus[] = ['requested', ...ACTIVE_RIDE_STATUSES];

// How long before its requested time a scheduled ride enters the search.
// MUST match the interval in migration 0013's policy — the database decides
// what drivers can see; this is only so the rider's screen can say what's
// happening ("we'll start looking about an hour before").
export const SCHEDULED_LEAD_MINUTES = 60;
const SCHEDULED_LEAD_MS = SCHEDULED_LEAD_MINUTES * 60 * 1000;

// A scheduled ride that hasn't entered the search yet: no driver can see it,
// so nobody is looking and the rider shouldn't be told otherwise.
export function isAwaitingSchedule(ride: RideRequestData, now: number = Date.now()): boolean {
  if (ride.rideMode !== 'scheduled') return false;
  const at = new Date(ride.requestedTime).getTime();
  return !Number.isNaN(at) && at - now > SCHEDULED_LEAD_MS;
}

// When this ride actually started (or will start) being offered to drivers —
// booking time for on-demand, the lead window for a scheduled ride. "Still
// looking for 14 hours" would be nonsense for a ride booked yesterday.
export function searchStartedAt(ride: RideRequestData): number {
  const created = new Date(ride.createdAt).getTime();
  if (ride.rideMode !== 'scheduled') return created;
  const at = new Date(ride.requestedTime).getTime();
  return Number.isNaN(at) ? created : Math.max(created, at - SCHEDULED_LEAD_MS);
}

export type NeedsSnapshot = {
  riderName: string;
  mobilityAid: string;
  foldable: string;
  communicationNeeds: string[];
  assistanceNeeds: string[];
  idDescription: string;
  // "Anything drivers should always know?" from the rider's profile.
  // Optional because rides booked before this was carried through don't
  // have it — read it defensively.
  standingNotes?: string;
};

export type RideRequestData = {
  id: string;
  requestedBy: string;
  riderId: string;
  companionCount: number;
  pickup: string;
  dropoff: string;
  rideMode: 'on_demand' | 'scheduled';
  requestedTime: string;
  rideNotes: string;
  needsSnapshot: NeedsSnapshot;
  status: RideStatus;
  matchedDriverId: string | null;
  // No pin here on purpose (0018): it lives in ride_pins, which drivers
  // cannot read — see fetchRidePin / startRideWithPin.
  createdAt: string; // ISO — when the ride was booked (how long it's been searching)
  feeCents: number; // 0 unless a late cancellation or no-show applied (0016)
  feeReason: 'late_cancellation' | 'no_show' | null;
  // Geocoding (0023) — null whenever the address didn't resolve, which is a
  // normal outcome. Screens must show nothing rather than guess a distance.
  pickupPoint: GeoPoint | null;
  dropoffPoint: GeoPoint | null;
  routeMeters: number | null;
  routeSeconds: number | null;
  // What the rider was quoted at booking, and what the driver earns on top
  // for an assisted ride (0026). Null when the ride has no route to price.
  fareEstimateCents: number | null;
  driverPremiumCents: number | null;
};

function mapRow(r: any): RideRequestData {
  return {
    id: r.id,
    requestedBy: r.requested_by,
    riderId: r.rider_id,
    companionCount: r.companion_count,
    pickup: r.pickup,
    dropoff: r.dropoff,
    rideMode: r.ride_mode,
    requestedTime: r.requested_time,
    rideNotes: r.ride_notes,
    needsSnapshot: r.needs_snapshot ?? {},
    status: r.status,
    matchedDriverId: r.matched_driver_id,
    createdAt: r.created_at,
    feeCents: r.fee_cents ?? 0,
    feeReason: r.fee_reason ?? null,
    pickupPoint: r.pickup_lat != null && r.pickup_lng != null ? { lat: r.pickup_lat, lng: r.pickup_lng, label: r.geo_pickup_label ?? r.pickup } : null,
    dropoffPoint: r.dropoff_lat != null && r.dropoff_lng != null ? { lat: r.dropoff_lat, lng: r.dropoff_lng, label: r.geo_dropoff_label ?? r.dropoff } : null,
    routeMeters: r.route_meters ?? null,
    routeSeconds: r.route_seconds ?? null,
    fareEstimateCents: r.fare_estimate_cents ?? null,
    driverPremiumCents: r.driver_premium_cents ?? null,
  };
}

export function buildNeedsSnapshot(rider: RiderProfileData): NeedsSnapshot {
  return {
    riderName: rider.fullName,
    mobilityAid: rider.mobilityAid,
    foldable: rider.foldable,
    communicationNeeds: rider.communicationNeeds,
    assistanceNeeds: rider.assistanceNeeds,
    idDescription: rider.idDescription,
    // The profile asks for this under "Anything drivers should always
    // know?" and then it went nowhere: it wasn't copied onto the ride, so
    // no driver ever saw it. Snapshotted like every other need, so editing
    // the profile can't rewrite what a driver was told about a past ride.
    standingNotes: rider.standingNotes,
  };
}

export async function createRideRequest(params: {
  requestedBy: string;
  riderId: string;
  companionCount: number;
  pickup: string;
  dropoff: string;
  rideMode: 'on_demand' | 'scheduled';
  requestedTime: string; // ISO
  rideNotes: string;
  needsSnapshot: NeedsSnapshot;
  // Best-effort geocoding (0023). Any part may be null — a ride books
  // without coordinates rather than failing when a lookup doesn't resolve.
  geo?: { pickup: GeoPoint | null; dropoff: GeoPoint | null; route: RouteInfo | null };
}): Promise<{ data: RideRequestData | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ride_requests')
    .insert({
      requested_by: params.requestedBy,
      rider_id: params.riderId,
      companion_count: params.companionCount,
      pickup: params.pickup,
      dropoff: params.dropoff,
      ride_mode: params.rideMode,
      requested_time: params.requestedTime,
      ride_notes: params.rideNotes,
      needs_snapshot: params.needsSnapshot,
      status: 'requested',
      pickup_lat: params.geo?.pickup?.lat ?? null,
      pickup_lng: params.geo?.pickup?.lng ?? null,
      dropoff_lat: params.geo?.dropoff?.lat ?? null,
      dropoff_lng: params.geo?.dropoff?.lng ?? null,
      geo_pickup_label: params.geo?.pickup?.label ?? null,
      geo_dropoff_label: params.geo?.dropoff?.label ?? null,
      route_meters: params.geo?.route?.meters ?? null,
      route_seconds: params.geo?.route?.seconds ?? null,
      // Priced from the route at booking and stored, so the number quoted
      // to this rider survives any later change to the rates (0026).
      fare_estimate_cents: params.geo?.route
        ? riderFareCents(params.geo.route.meters, params.geo.route.seconds)
        : null,
      driver_premium_cents: params.geo?.route ? driverServicePremiumCents(params.needsSnapshot) : null,
      geocoded_at: params.geo?.pickup || params.geo?.dropoff ? new Date().toISOString() : null,
      // The pin is issued by a trigger (0018) — a pin the client chose
      // wouldn't be a check on anything.
    })
    .select('*')
    .single();
  if (error) return { data: null, error: error.message };
  return { data: mapRow(data), error: null };
}

export async function fetchRideRequest(id: string): Promise<{ data: RideRequestData | null; error: string | null }> {
  const { data, error } = await supabase.from('ride_requests').select('*').eq('id', id).maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data ? mapRow(data) : null, error: null };
}

// Loses the race gracefully if the ride is no longer open (another driver
// claimed it, or the rider cancelled) — but an UPDATE that matches zero rows
// is not an error to PostgREST, so success has to be confirmed by getting
// the claimed row back, not just by the absence of an error.
export async function acceptRideRequest(rideId: string, driverId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('ride_requests')
    .update({ status: 'matched', matched_driver_id: driverId, updated_at: new Date().toISOString() })
    .eq('id', rideId)
    .eq('status', 'requested')
    .select('id');
  // 23505 = migration 0007's one-active-ride-per-driver index.
  if (error?.code === '23505') return { error: 'You already have an active ride.' };
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'This ride is no longer available.' };
  return { error: null };
}

// The driver's own in-progress ride, if any (see ACTIVE_RIDE_STATUSES).
export async function fetchActiveRideForDriver(driverId: string): Promise<{ data: RideRequestData | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ride_requests')
    .select('*')
    .eq('matched_driver_id', driverId)
    .in('status', ACTIVE_RIDE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data ? mapRow(data) : null, error: null };
}

// How many drivers could actually take this ride right now: available, able
// to serve its needs, haven't declined it, and not already on another ride
// (migration 0011). 0 means nobody is coming until someone comes online or a
// requirement changes — which is the difference between "still looking" and
// "no drivers available" on the matching screen. Requester-only, enforced in
// the function.
export async function countEligibleDriversForRide(rideId: string): Promise<{ count: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc('count_eligible_drivers_for_ride', { p_ride_id: rideId });
  if (error) return { count: null, error: error.message };
  return { count: typeof data === 'number' ? data : null, error: null };
}

// Move a ride that's still searching to a scheduled time, keeping the SAME
// ride row so the rider doesn't have to rebook. Conditional on 'requested' so
// it can't rewrite a ride a driver has just accepted.
// NOTE: scheduled rides are still offered to drivers immediately — holding
// them back until closer to requested_time isn't built yet (SPEC.md §2.4), so
// don't tell the rider we'll wait until then.
export async function rescheduleRideRequest(rideId: string, whenISO: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('ride_requests')
    .update({ ride_mode: 'scheduled', requested_time: whenISO, updated_at: new Date().toISOString() })
    .eq('id', rideId)
    .eq('status', 'requested')
    .select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "This ride is no longer waiting for a driver, so it can't be rescheduled." };
  return { error: null };
}

// The rider's ride that's still going, if any (see OPEN_RIDE_STATUSES).
// Either one they booked themselves or one a proxy booked for them (0017) —
// otherwise a rider whose helper booked would be shown "Book a Ride" and
// could end up with two.
export async function fetchActiveRideForRider(riderUserId: string): Promise<{ data: RideRequestData | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ride_requests')
    .select('*')
    .or(`requested_by.eq.${riderUserId},rider_id.eq.${riderUserId}`)
    .in('status', OPEN_RIDE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data ? mapRow(data) : null, error: null };
}

// Driver-side progression: matched → driver_en_route → arrived →
// in_progress → completed. Existing RLS already allows this ("driver claims
// a requested ride" also matches rows where matched_driver_id = auth.uid(),
// and its check keeps it that way), so no migration is needed. The update is
// conditional on the status the screen last saw, so a stale screen can't
// advance a ride that was cancelled (or already advanced) in the meantime.
export async function advanceRideStatus(
  rideId: string,
  from: RideStatus,
  to: RideStatus
): Promise<{ data: RideRequestData | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ride_requests')
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq('id', rideId)
    .eq('status', from)
    .select('*');
  if (error) return { data: null, error: error.message };
  if (!data || data.length === 0) return { data: null, error: 'This ride was updated elsewhere — it may have been cancelled.' };
  return { data: mapRow(data[0]), error: null };
}

// Driver backs out before pickup. The ride isn't ended — it goes back into
// the search (status 'requested', driver cleared and added to
// declined_driver_ids so they aren't offered it again), so the rider keeps
// their booking and just gets a new driver. A SECURITY DEFINER function
// (migration 0008) because RLS doesn't let a driver clear
// matched_driver_id; it checks the caller is the matched driver and the ride
// hasn't been picked up yet.
export async function driverCancelRide(rideId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('driver_cancel_ride', { p_ride_id: rideId });
  if (!error) return { error: null };
  if (error.code === '55000') return { error: "This ride can't be cancelled any more — it has already started or ended." };
  if (error.code === '42501') return { error: "You're no longer the driver on this ride." };
  return { error: error.message };
}

// Marks this ride as declined by this driver (ride stays 'requested' for
// everyone else) — an atomic array-append via RPC, not a read-modify-write,
// so two drivers declining at once can't clobber each other's entry.
export async function declineRideRequest(rideId: string, driverId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('decline_ride_request', { p_ride_id: rideId, p_driver_id: driverId });
  return { error: error?.message ?? null };
}

// The "go back to live search" half of decline reassignment: a driver
// going available (or returning to Driver Home right after declining) needs
// to find any ALREADY-open ride, not just wait for a brand-new INSERT — RLS
// already excludes rides this driver declined and rides no longer
// 'requested', so whatever comes back here is genuinely still up for grabs.
export async function fetchOldestOpenRequest(): Promise<{ data: RideRequestData | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ride_requests')
    .select('*')
    .eq('status', 'requested')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data ? mapRow(data) : null, error: null };
}

// The cancellation policy (SPEC.md §4), decided in migration 0016 — these
// mirror the SQL constants purely so the app can say what the rules are.
// The numbers that actually apply are the ones in the function.
//
// CANCEL_GRACE_MINUTES is deliberately gone: the grace deadline now comes
// from `cancel_quote()` (0021) per ride, and a spare 15 sitting here was an
// invitation to recompute the rule client-side again — which is exactly how
// the screen ended up promising "free to cancel" on a ride that cost $12.
// LATE_CANCEL_FEE_CENTS survives only for the "we couldn't check" fallback
// copy, where there is no quote to name a real number.
export const LATE_CANCEL_FEE_CENTS = 1200;
export const NO_SHOW_WAIT_MINUTES = 10;
export const NO_SHOW_FEE_CENTS = 1500;

export function formatFee(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export type FeeOutcome = { feeCents: number; feeReason: 'late_cancellation' | 'no_show' | null };

// Rider cancels, through the database rather than a direct UPDATE: whether a
// fee applies depends on how long ago a driver was matched, and that's not a
// decision to leave to the client. Free while still searching or inside the
// grace window; a flat fee after it. Nothing charges anyone — no payments
// exist in this app — the fee is recorded on the ride.
export type CancelQuote = {
  cancellable: boolean;
  feeCents: number;
  feeReason: string | null;
  // When the free window shuts. Null means there's nothing to count down to:
  // either no driver has been matched yet (always free) or the ride is past
  // cancelling entirely.
  freeUntil: number | null;
};

// What cancelling costs right now, decided by the same database function that
// does the charging (0021). The screen used to work this out itself from the
// event log plus its own copy of the rule, which is how it ended up promising
// "free to cancel" on a ride the server then charged $12 for.
export async function fetchCancelQuote(rideId: string): Promise<{ data: CancelQuote | null; error: string | null }> {
  const { data, error } = await supabase.rpc('cancel_quote', { p_ride_id: rideId });
  if (error) return { data: null, error: error.message };
  const row = (data ?? {}) as any;
  return {
    data: {
      cancellable: row.cancellable !== false,
      feeCents: Number(row.fee_cents ?? 0),
      feeReason: row.fee_reason ?? null,
      freeUntil: row.free_until ? new Date(row.free_until).getTime() : null,
    },
    error: null,
  };
}

export async function cancelRideRequest(rideId: string): Promise<{ data: FeeOutcome | null; error: string | null }> {
  const { data, error } = await supabase.rpc('rider_cancel_ride', { p_ride_id: rideId });
  if (error?.code === '55000') return { data: null, error: "This ride can't be cancelled any more — it has already started or ended." };
  if (error?.code === '42501') return { data: null, error: 'This is no longer your ride to cancel.' };
  if (error) return { data: null, error: error.message };
  const row = (data ?? {}) as any;
  return { data: { feeCents: Number(row.fee_cents ?? 0), feeReason: row.fee_reason ?? null }, error: null };
}

// The driver waited at pickup and nobody came. Only from 'arrived', only
// after the real wait, and only by the driver on the ride — all checked in
// the database (0016), not here.
export async function markNoShow(rideId: string): Promise<{ data: FeeOutcome | null; error: string | null }> {
  const { data, error } = await supabase.rpc('mark_no_show', { p_ride_id: rideId });
  if (error?.code === '55000') return { data: null, error: error.message.replace(/^.*?:\s*/, '') };
  if (error?.code === '42501') return { data: null, error: "You're no longer the driver on this ride." };
  if (error) return { data: null, error: error.message };
  const row = (data ?? {}) as any;
  return { data: { feeCents: Number(row.fee_cents ?? 0), feeReason: row.fee_reason ?? null }, error: null };
}

// One entry in a ride's status history, written by migration 0009's trigger
// (never by a client). Readable by whoever booked the ride and by the ride's
// current matched driver.
export type RideEvent = {
  id: string;
  rideId: string;
  status: RideStatus;
  driverId: string | null;
  at: string; // ISO
};

function mapEvent(r: any): RideEvent {
  return { id: r.id, rideId: r.ride_id, status: r.status, driverId: r.driver_id, at: r.at };
}

export async function fetchRideEvents(rideId: string): Promise<{ data: RideEvent[]; error: string | null }> {
  const { data, error } = await supabase.from('ride_events').select('*').eq('ride_id', rideId).order('at', { ascending: true });
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []).map(mapEvent), error: null };
}

// New steps as they happen, for the tracking timeline.
export function subscribeToRideEvents(rideId: string, onEvent: (event: RideEvent) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(uniqueTopic(`ride-events-${rideId}`))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ride_events', filter: `ride_id=eq.${rideId}` },
      (payload) => onEvent(mapEvent(payload.new))
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// Public-enough fields of the matched driver, for the rider's en-route
// screen (allowed by the "rider reads their matched driver's profile" RLS
// policy — only once that driver is actually matched_driver_id on one of
// this rider's own rides).
export type MatchedDriverInfo = Pick<
  DriverProfileData,
  'fullName' | 'vehicle' | 'plate' | 'rampEquipped' | 'capabilityTags'
>;

// Asked by ride, not by driver id, and answered by the database (0018): the
// old version read driver_profiles directly, and since RLS can't restrict
// columns that exposed the driver's licence number, date of birth and phone
// to any rider matched to them. This returns only what the screens show.
export async function fetchMatchedDriver(rideId: string): Promise<{ data: MatchedDriverInfo | null; error: string | null }> {
  const { data, error } = await supabase.rpc('matched_driver_public', { p_ride_id: rideId });
  if (error?.code === '42501') return { data: null, error: 'That is not your ride.' };
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: null }; // no driver matched yet
  const row = data as any;
  return {
    data: {
      fullName: row.full_name ?? '',
      vehicle: row.vehicle ?? '',
      plate: row.plate ?? '',
      rampEquipped: row.ramp_equipped ?? 'Yes',
      capabilityTags: row.capability_tags ?? [],
    },
    error: null,
  };
}

// The rider's copy of the pickup pin (0018). Drivers have no read access to
// this table at all — they check the pin through startRideWithPin.
export async function fetchRidePin(rideId: string): Promise<{ data: string | null; error: string | null }> {
  const { data, error } = await supabase.from('ride_pins').select('pin').eq('ride_id', rideId).maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data?.pin ?? null, error: null };
}

// The driver confirms the pin and the ride starts in the same call, so a
// wrong pin can't be stepped past by calling the status update directly.
// Five wrong attempts lock it — four digits is only 10,000 guesses.
// A rider (or their proxy) replaces the pin and clears the attempt counter
// (0028). This is the way out of the five-wrong-attempts lockout, which used
// to end at "contact support" — support that does not exist, leaving a ride
// that could never start.
export async function reissueRidePin(rideId: string): Promise<{ data: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('reissue_ride_pin', { p_ride_id: rideId });
  if (error?.code === '42501') return { data: null, error: 'This is no longer your ride.' };
  if (error?.code === '55000') return { data: null, error: "This ride doesn't need a PIN right now." };
  if (error) return { data: null, error: error.message };
  return { data: ((data ?? {}) as any).pin ?? null, error: null };
}

export async function startRideWithPin(rideId: string, pin: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.rpc('start_ride_with_pin', { p_ride_id: rideId, p_pin: pin });
  if (error?.code === '55000') return { error: error.message.replace(/^.*?:\s*/, '') };
  if (error?.code === '42501') return { error: "You're no longer the driver on this ride." };
  if (error) return { error: error.message };
  // A wrong pin comes back as a result rather than an error, so the attempt
  // counter survives (0019).
  const row = (data ?? {}) as any;
  if (row.started === false) {
    const left = Number(row.attempts_left ?? 0);
    return {
      error:
        left > 0
          ? `That PIN doesn't match. Ask the rider to read the PIN shown in their app — ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : "That PIN doesn't match, and that was the last try. Ask the rider to tap \u201cGet a new PIN\u201d in their app, then try again.",
    };
  }
  return { error: null };
}

export type EmergencyContactForDriver = { id: string; name: string; phone: string; relationship?: string };

// The rider's emergency contacts, readable by the matched driver only between
// pickup and dropoff (migration 0020). Every call is logged for the rider, so
// this must stay behind a deliberate tap on the driver's screen — never a
// fetch on render, which would fill the rider's access log with views that
// never happened.
export async function fetchRideEmergencyContacts(
  rideId: string
): Promise<{ data: EmergencyContactForDriver[]; error: string | null }> {
  const { data, error } = await supabase.rpc('ride_emergency_contacts', { p_ride_id: rideId });
  if (error?.code === '42501') return { data: [], error: "You're no longer the driver on this ride." };
  if (error?.code === '55000') return { data: [], error: 'Emergency contacts are only available during the ride.' };
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as EmergencyContactForDriver[], error: null };
}

// The other half of the promise on the profile screen: the rider can see when
// a driver opened their emergency contacts. RLS (0020) limits this to the
// rider's own rides, so a caregiver booking on their behalf sees nothing.
export async function fetchEmergencyAccessForRide(rideId: string): Promise<{ data: string[]; error: string | null }> {
  const { data, error } = await supabase
    .from('emergency_contact_access')
    .select('viewed_at')
    .eq('ride_id', rideId)
    .order('viewed_at');
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []).map((r: any) => r.viewed_at as string), error: null };
}

// Supabase-js caches channels by name — calling supabase.channel() again
// with a name already subscribed elsewhere returns that SAME channel
// object, and adding a listener to an already-subscribed channel throws
// ("cannot add postgres_changes callbacks... after subscribe()"). That's
// exactly what happens on a remount race (e.g. a screen replacing itself
// right after the previous instance's cleanup was scheduled but hasn't run
// yet) if two subscriptions ever share a name — so every call here gets a
// fresh, unique topic instead of a fixed one.
function uniqueTopic(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

// Live updates on one specific ride — the rider following their ride's
// status, or the matched driver seeing the rider cancel. Realtime only
// delivers a change if the subscriber can still SELECT the row afterwards
// (RLS is checked per subscriber), so this can't tell a driver viewing an
// open offer that the ride was cancelled or taken — see incoming.tsx.
export function subscribeToRide(rideId: string, onChange: (ride: RideRequestData) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(uniqueTopic(`ride-${rideId}`))
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'ride_requests', filter: `id=eq.${rideId}` },
      (payload) => onChange(mapRow(payload.new))
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// Driver side: live feed of rides that become open while available — new
// requests (INSERT) and rides a driver handed back into the search
// (driverCancelRide, an UPDATE back to 'requested'). RLS already hides rides
// this driver declined or handed back, so only rides they can take arrive.
export function subscribeToIncomingRequests(onOpen: (ride: RideRequestData) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(uniqueTopic('incoming-ride-requests'))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ride_requests', filter: 'status=eq.requested' },
      (payload) => onOpen(mapRow(payload.new))
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'ride_requests', filter: 'status=eq.requested' },
      (payload) => onOpen(mapRow(payload.new))
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
