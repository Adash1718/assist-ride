import { supabase } from './supabase';

// Post-ride feedback (SPEC.md §2.6, migration 0014). Written once by whoever
// booked the ride, after it's completed, and immutable afterwards. Drivers
// can't read individual rows — only their own aggregate.

export type RideFeedback = {
  rideId: string;
  driverId: string;
  mobilityRating: number;
  patienceRating: number;
  vehicleRating: number;
  overallRating: number;
  comment: string;
  createdAt: string;
};

export type DriverRating = {
  count: number;
  overall: number | null;
  mobility: number | null;
  patience: number | null;
  vehicle: number | null;
};

function mapRow(r: any): RideFeedback {
  return {
    rideId: r.ride_id,
    driverId: r.driver_id,
    mobilityRating: r.mobility_rating,
    patienceRating: r.patience_rating,
    vehicleRating: r.vehicle_rating,
    overallRating: r.overall_rating,
    comment: r.comment ?? '',
    createdAt: r.created_at,
  };
}

// What this rider already submitted for this ride, if anything — the
// completion screen shows it back instead of an empty form.
export async function fetchRideFeedback(rideId: string): Promise<{ data: RideFeedback | null; error: string | null }> {
  const { data, error } = await supabase.from('ride_feedback').select('*').eq('ride_id', rideId).maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data ? mapRow(data) : null, error: null };
}

export async function submitRideFeedback(params: {
  rideId: string;
  riderId: string;
  driverId: string;
  mobilityRating: number;
  patienceRating: number;
  vehicleRating: number;
  overallRating: number;
  comment: string;
}): Promise<{ data: RideFeedback | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ride_feedback')
    .insert({
      ride_id: params.rideId,
      rider_id: params.riderId,
      driver_id: params.driverId,
      mobility_rating: params.mobilityRating,
      patience_rating: params.patienceRating,
      vehicle_rating: params.vehicleRating,
      overall_rating: params.overallRating,
      comment: params.comment.trim(),
    })
    .select('*')
    .single();
  // 23505 = the ride_id primary key: this ride was already rated.
  if (error?.code === '23505') return { data: null, error: "You've already rated this ride." };
  // 42501 = the insert policy: not your ride, or it isn't completed.
  if (error?.code === '42501') return { data: null, error: "This ride can't be rated — it isn't finished yet." };
  if (error) return { data: null, error: error.message };
  return { data: mapRow(data), error: null };
}

// The signed-in driver's own rating. No argument, so a driver can't ask
// about anyone else (migration 0014). count 0 means no feedback yet, and the
// averages come back null rather than 0.
export async function fetchMyDriverRating(): Promise<{ data: DriverRating | null; error: string | null }> {
  const { data, error } = await supabase.rpc('my_driver_rating');
  if (error) return { data: null, error: error.message };
  const row = (data ?? {}) as any;
  return {
    data: {
      count: Number(row.count ?? 0),
      overall: row.overall === null || row.overall === undefined ? null : Number(row.overall),
      mobility: row.mobility === null || row.mobility === undefined ? null : Number(row.mobility),
      patience: row.patience === null || row.patience === undefined ? null : Number(row.patience),
      vehicle: row.vehicle === null || row.vehicle === undefined ? null : Number(row.vehicle),
    },
    error: null,
  };
}
