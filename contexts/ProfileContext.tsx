import { createContext, ReactNode, useContext, useState } from 'react';

// In-memory stand-in for real accounts/database (SPEC.md §6: no auth, no
// Supabase tables yet). This just lets whatever someone types during sign-up
// actually show up elsewhere in the app instead of every screen showing the
// same hardcoded demo person.

export type ContactRecord = {
  id: string;
  name: string;
  phone: string;
  address: string;
  email: string;
};

export type MedicalContactRecord = ContactRecord & {
  specialty: string;
  hospital: string;
};

export type RiderProfileData = {
  fullName: string;
  dateOfBirth: string;
  phone: string;
  photoUri: string | null;
  mobilityAid: string;
  foldable: string;
  communicationNeeds: string[];
  assistanceNeeds: string[];
  standingNotes: string;
  idDescription: string;
  emergencyContacts: ContactRecord[];
  medicalContacts: MedicalContactRecord[];
};

export type DriverProfileData = {
  fullName: string;
  dateOfBirth: string;
  phone: string;
  licenseNumber: string;
  vehicle: string;
  plate: string;
  rampEquipped: string;
  capabilityTags: string[];
  companionSeats: number;
  verificationAnswers: Record<string, string>;
  verified: boolean;
  isAvailable: boolean;
};

const emptyRider: RiderProfileData = {
  fullName: '',
  dateOfBirth: '',
  phone: '',
  photoUri: null,
  mobilityAid: 'None',
  foldable: 'Yes',
  communicationNeeds: [],
  assistanceNeeds: [],
  standingNotes: '',
  idDescription: '',
  emergencyContacts: [],
  medicalContacts: [],
};

const emptyDriver: DriverProfileData = {
  fullName: '',
  dateOfBirth: '',
  phone: '',
  licenseNumber: '',
  vehicle: '',
  plate: '',
  rampEquipped: 'Yes',
  capabilityTags: [],
  companionSeats: 3,
  verificationAnswers: {},
  verified: false,
  isAvailable: false,
};

type ProfileContextValue = {
  rider: RiderProfileData;
  setRider: (patch: Partial<RiderProfileData>) => void;
  driver: DriverProfileData;
  setDriver: (patch: Partial<DriverProfileData>) => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [rider, setRiderState] = useState<RiderProfileData>(emptyRider);
  const [driver, setDriverState] = useState<DriverProfileData>(emptyDriver);

  const setRider = (patch: Partial<RiderProfileData>) => setRiderState((prev) => ({ ...prev, ...patch }));
  const setDriver = (patch: Partial<DriverProfileData>) => setDriverState((prev) => ({ ...prev, ...patch }));

  return <ProfileContext.Provider value={{ rider, setRider, driver, setDriver }}>{children}</ProfileContext.Provider>;
}

export function useProfiles() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfiles must be used within a ProfileProvider');
  return ctx;
}
