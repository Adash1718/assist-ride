import { supabase } from './supabase';
import { ContactRecord, DriverProfileData, MedicalContactRecord, RiderProfileData } from '../contexts/ProfileContext';

// Bridges ProfileContext's camelCase shape to Supabase's snake_case columns
// (supabase/migrations/0001_init.sql). Every call here can fail (network,
// RLS, not-yet-created project) — callers surface the returned error rather
// than assuming success.

// A bare row exists from the moment of sign-up (ensureRiderProfileRow /
// ensureDriverProfileRow), before the create-profile form is ever
// submitted — so "a row exists" is NOT the same as "profile is set up".
// `fullName` is only ever non-empty once the create-profile form has
// actually been submitted (its CTA is disabled until name/phone/dob are
// valid), so it's a reliable, cheap completeness signal. Every place that
// can land an authenticated user somewhere (Welcome's auto-redirect,
// sign-in, and each home screen's own guard) must route through this check
// — riders and drivers must finish their profile before booking/accepting
// rides.
export function isRiderProfileComplete(data: RiderProfileData | null): boolean {
  return !!data && data.fullName.trim() !== '';
}

export function isDriverProfileComplete(data: DriverProfileData | null): boolean {
  return !!data && data.fullName.trim() !== '';
}

function toRiderRow(userId: string, data: Partial<RiderProfileData>) {
  return {
    id: userId,
    full_name: data.fullName,
    date_of_birth: data.dateOfBirth ? isoFromDob(data.dateOfBirth) : null,
    phone: data.phone,
    photo_url: data.photoUri,
    mobility_aid: data.mobilityAid,
    foldable: data.foldable,
    communication_needs: data.communicationNeeds,
    assistance_needs: data.assistanceNeeds,
    standing_notes: data.standingNotes,
    id_description: data.idDescription,
    updated_at: new Date().toISOString(),
  };
}

function toDriverRow(userId: string, data: Partial<DriverProfileData>) {
  return {
    id: userId,
    full_name: data.fullName,
    date_of_birth: data.dateOfBirth ? isoFromDob(data.dateOfBirth) : null,
    phone: data.phone,
    license_number: data.licenseNumber,
    vehicle: data.vehicle,
    plate: data.plate,
    ramp_equipped: data.rampEquipped,
    capability_tags: data.capabilityTags,
    companion_seats: data.companionSeats,
    verification_answers: data.verificationAnswers,
    verified: data.verified,
    is_available: data.isAvailable,
    updated_at: new Date().toISOString(),
  };
}

// "MM/DD/YYYY" -> "YYYY-MM-DD" for a Postgres `date` column.
function isoFromDob(dob: string): string | null {
  const m = dob.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function dobFromIso(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

export async function ensureRiderProfileRow(userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('rider_profiles').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
  return { error: error?.message ?? null };
}

export async function ensureDriverProfileRow(userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('driver_profiles').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
  return { error: error?.message ?? null };
}

export async function saveRiderProfile(userId: string, data: RiderProfileData): Promise<{ error: string | null }> {
  const { error } = await supabase.from('rider_profiles').upsert(toRiderRow(userId, data));
  return { error: error?.message ?? null };
}

export async function saveDriverProfile(userId: string, data: DriverProfileData): Promise<{ error: string | null }> {
  const { error } = await supabase.from('driver_profiles').upsert(toDriverRow(userId, data));
  return { error: error?.message ?? null };
}

export async function fetchRiderProfile(userId: string): Promise<{ data: RiderProfileData | null; error: string | null }> {
  const [profileRes, emergencyRes, medicalRes] = await Promise.all([
    supabase.from('rider_profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('emergency_contacts').select('*').eq('rider_id', userId),
    supabase.from('medical_contacts').select('*').eq('rider_id', userId),
  ]);
  if (profileRes.error) return { data: null, error: profileRes.error.message };
  if (!profileRes.data) return { data: null, error: null };
  const p = profileRes.data;
  const emergencyContacts: ContactRecord[] = (emergencyRes.data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    address: c.address,
    email: c.email,
  }));
  const medicalContacts: MedicalContactRecord[] = (medicalRes.data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    address: c.address,
    email: c.email,
    specialty: c.specialty,
    hospital: c.hospital,
  }));
  return {
    data: {
      fullName: p.full_name ?? '',
      dateOfBirth: dobFromIso(p.date_of_birth),
      phone: p.phone ?? '',
      photoUri: p.photo_url,
      mobilityAid: p.mobility_aid ?? 'None',
      foldable: p.foldable ?? 'Yes',
      communicationNeeds: p.communication_needs ?? [],
      assistanceNeeds: p.assistance_needs ?? [],
      standingNotes: p.standing_notes ?? '',
      idDescription: p.id_description ?? '',
      emergencyContacts,
      medicalContacts,
    },
    error: null,
  };
}

export async function fetchDriverProfile(userId: string): Promise<{ data: DriverProfileData | null; error: string | null }> {
  const { data: p, error } = await supabase.from('driver_profiles').select('*').eq('id', userId).maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!p) return { data: null, error: null };
  return {
    data: {
      fullName: p.full_name ?? '',
      dateOfBirth: dobFromIso(p.date_of_birth),
      phone: p.phone ?? '',
      licenseNumber: p.license_number ?? '',
      vehicle: p.vehicle ?? '',
      plate: p.plate ?? '',
      rampEquipped: p.ramp_equipped ?? 'Yes',
      capabilityTags: p.capability_tags ?? [],
      companionSeats: p.companion_seats ?? 3,
      verificationAnswers: p.verification_answers ?? {},
      verified: p.verified ?? false,
      isAvailable: p.is_available ?? false,
    },
    error: null,
  };
}

export async function setDriverAvailability(driverId: string, isAvailable: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase.from('driver_profiles').update({ is_available: isAvailable }).eq('id', driverId);
  return { error: error?.message ?? null };
}

export async function addEmergencyContact(
  riderId: string,
  contact: Omit<ContactRecord, 'id'>
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.from('emergency_contacts').insert({ rider_id: riderId, ...contact }).select('id').single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

export async function addMedicalContact(
  riderId: string,
  contact: Omit<MedicalContactRecord, 'id'>
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.from('medical_contacts').insert({ rider_id: riderId, ...contact }).select('id').single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

export async function deleteEmergencyContact(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('emergency_contacts').delete().eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteMedicalContact(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('medical_contacts').delete().eq('id', id);
  return { error: error?.message ?? null };
}
