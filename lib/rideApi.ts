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

export async function acceptRideRequest(rideId: string, driverId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('ride_requests')
    .update({ status: 'matched', matched_driver_id: driverId, updated_at: new Date().toISOString() })
    .eq('id', rideId)
    .eq('status', 'requested'); // loses the race gracefully if another driver already claimed it
  return { error: error?.message ?? null };
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

// Rider side: live updates on one specific ride (e.g. status flips to
// 'matched').
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
