import { supabase } from './supabase';

// Reporting that something went wrong on a ride (migration 0032).
//
// The report does one concrete thing, and the UI should promise only that:
// the reported driver is never matched to this rider again. There is no
// support desk behind this, and saying "we'll review it" when nobody will is
// the kind of empty promise this app has had to remove elsewhere.

export const INCIDENT_CATEGORIES = [
  { key: 'unsafe_driving', label: 'Unsafe driving' },
  { key: 'rough_handling', label: 'Rough or unsafe physical help' },
  { key: 'rude_or_dismissive', label: 'Rude or dismissive' },
  { key: 'left_stranded', label: 'Left me stranded' },
  { key: 'assistance_refused', label: 'Refused the help I booked' },
  { key: 'other', label: 'Something else' },
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number]['key'];

export type RideIncident = {
  id: string;
  rideId: string;
  driverId: string;
  category: IncidentCategory;
  details: string;
  createdAt: string;
};

function mapRow(r: any): RideIncident {
  return {
    id: r.id,
    rideId: r.ride_id,
    driverId: r.driver_id,
    category: r.category,
    details: r.details ?? '',
    createdAt: r.created_at,
  };
}

export async function reportIncident(params: {
  rideId: string;
  riderId: string;
  driverId: string;
  reportedBy: string;
  category: IncidentCategory;
  details: string;
}): Promise<{ data: RideIncident | null; error: string | null }> {
  const { data, error } = await supabase
    .from('ride_incidents')
    .insert({
      ride_id: params.rideId,
      rider_id: params.riderId,
      driver_id: params.driverId,
      reported_by: params.reportedBy,
      category: params.category,
      details: params.details.trim().slice(0, 2000),
    })
    .select('*')
    .single();
  // 42501 = the insert policy: not your ride, or that driver didn't do it.
  if (error?.code === '42501') return { data: null, error: "This report can't be filed against that ride." };
  if (error) return { data: null, error: error.message };
  return { data: mapRow(data), error: null };
}

// Reports this person filed or that concern them. Drivers get nothing — a
// report must never be traceable back to the rider who made it.
export async function fetchIncidentsForRide(rideId: string): Promise<{ data: RideIncident[]; error: string | null }> {
  const { data, error } = await supabase.from('ride_incidents').select('*').eq('ride_id', rideId).order('created_at');
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []).map(mapRow), error: null };
}
