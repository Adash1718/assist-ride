import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { DriverProfileData, RiderProfileData } from '../contexts/ProfileContext';

// Real ride-request wiring (SPEC.md §2.4, supabase/migrations/0002_*.sql).
// Matching is intentionally minimal for this pass: any available driver
// sees any 'requested' ride — no capability/tag filtering yet (see SPEC.md
// for that as a documented next step).

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

// Statuses only ever move forward, so when a fetch result and a Realtime
// update race each other, the further-along one is the current one.
const STATUS_RANK: Record<RideStatus, number> = {
  requested: 0,
  matched: 1,
  driver_en_route: 2,
  arrived: 3,
  in_progress: 4,
  completed: 5,
  cancelled: 5,
  no_show: 5,
};

export function newerRide(prev: RideRequestData | null, next: RideRequestData): RideRequestData {
  return prev && prev.id === next.id && STATUS_RANK[prev.status] > STATUS_RANK[next.status] ? prev : next;
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

export async function cancelRideRequest(rideId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('ride_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', rideId);
  return { error: error?.message ?? null };
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
// status, or the matched driver seeing the rider cancel.
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

// Driver side: live feed of newly requested rides while available.
export function subscribeToIncomingRequests(onInsert: (ride: RideRequestData) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(uniqueTopic('incoming-ride-requests'))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ride_requests', filter: 'status=eq.requested' },
      (payload) => onInsert(mapRow(payload.new))
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
