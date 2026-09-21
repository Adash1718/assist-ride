import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
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
  pin: string | null;
  createdAt: string; // ISO — when the ride was booked (how long it's been searching)
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
    pin: r.pin,
    createdAt: r.created_at,
  };
}

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function buildNeedsSnapshot(rider: RiderProfileData): NeedsSnapshot {
  return {
    riderName: rider.fullName,
    mobilityAid: rider.mobilityAid,
    foldable: rider.foldable,
    communicationNeeds: rider.communicationNeeds,
    assistanceNeeds: rider.assistanceNeeds,
    idDescription: rider.idDescription,
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
      pin: generatePin(),
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
export async function fetchActiveRideForRider(riderUserId: string): Promise<{ data: RideRequestData | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ride_requests')
    .select('*')
    .eq('requested_by', riderUserId)
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

// Rider cancels. Only before pickup, and conditional on that, so a stale
// screen can't cancel a ride that's already in progress or finished (e.g.
// the driver completing it just as the rider taps Cancel) — confirmed by
// getting the row back, since a zero-row UPDATE isn't an error.
export async function cancelRideRequest(rideId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('ride_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', rideId)
    .in('status', ['requested', ...PRE_PICKUP_STATUSES])
    .select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "This ride can't be cancelled any more — it has already started or ended." };
  return { error: null };
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

export async function fetchMatchedDriver(driverId: string): Promise<{ data: MatchedDriverInfo | null; error: string | null }> {
  const { data, error } = await supabase
    .from('driver_profiles')
    .select('full_name, vehicle, plate, ramp_equipped, capability_tags')
    .eq('id', driverId)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: null };
  return {
    data: {
      fullName: data.full_name ?? '',
      vehicle: data.vehicle ?? '',
      plate: data.plate ?? '',
      rampEquipped: data.ramp_equipped ?? 'Yes',
      capabilityTags: data.capability_tags ?? [],
    },
    error: null,
  };
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
