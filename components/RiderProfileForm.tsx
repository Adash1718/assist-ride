import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { colors, spacing, type } from '../constants/theme';
import {
  Avatar,
  Card,
  Chip,
  Divider,
  Hint,
  IconButton,
  PrimaryButton,
  SectionLabel,
  SegmentedControl,
  Screen,
  TopBar,
} from './ui';
import { CameraIcon, CloseIcon, PlusIcon } from './Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfiles } from '../contexts/ProfileContext';
import { useAuth } from '../contexts/AuthContext';
import { initialsFrom } from '../lib/format';
import { formatDobInput, formatPhoneInput, isValidDob, isValidPhone } from '../lib/validators';
import { ContactModal, MedicalContactInput } from './ContactModal';
import { addEmergencyContact, addMedicalContact, deleteEmergencyContact, deleteMedicalContact, saveRiderProfile } from '../lib/profileApi';

const MOBILITY_AIDS = ['None', 'Cane', 'Walker', 'Manual wheelchair', 'Power wheelchair', 'Other'];
const COMMUNICATION_NEEDS = ['Hard of hearing', 'Vision impaired', 'Needs extra time', 'Prefers simple instructions', 'Other'];
const ASSISTANCE_NEEDS = ['Door-to-door escort', 'Help transferring to seat', 'Service animal', 'Extra patience needed'];

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function labeledInput(
  label: string,
  value: string,
  onChangeText: (v: string) => void,
  placeholder?: string,
  keyboardType?: 'default' | 'phone-pad',
  errorText?: string
) {
  return (
    <>
      <Text style={type.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        keyboardType={keyboardType}
        // The visible <Text> above is not associated with this field for a
        // screen reader, so without this the input announces as an unlabelled
        // edit box. The error is folded in so it's heard, not just seen.
        accessibilityLabel={errorText ? `${label}. ${errorText}` : label}
        style={{
          borderWidth: 1,
          borderColor: errorText ? colors.alert : colors.border,
          borderRadius: 12,
          padding: 14,
          fontSize: 16,
          color: colors.text,
        }}
      />
      {errorText ? <Text style={{ fontSize: 12.5, color: colors.alertDark }}>{errorText}</Text> : null}
    </>
  );
}

// Shared by onboarding sign-up (create) and the rider-side edit screen —
// same fields either way (SPEC.md §2.2), only the title/CTA/back behavior
// differ. State lives in ProfileContext, not local state, so whatever is
// entered here actually shows up on the rider's home screen, ride requests,
// etc. instead of a fixed demo name.
export function RiderProfileForm({
  title,
  ctaLabel,
  onSubmit,
  onBack,
}: {
  title: string;
  ctaLabel: string;
  onSubmit: () => void;
  onBack?: () => void;
}) {
  const { rider, setRider } = useProfiles();
  const { user } = useAuth();
  const [contactModal, setContactModal] = useState<'emergency' | 'doctor' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const phoneError = rider.phone !== '' && !isValidPhone(rider.phone) ? '10-digit US phone number required' : undefined;
  const dobError = rider.dateOfBirth !== '' && !isValidDob(rider.dateOfBirth) ? 'Enter a valid past date (MM/DD/YYYY)' : undefined;
  const canSubmit = rider.fullName.trim() !== '' && isValidPhone(rider.phone) && isValidDob(rider.dateOfBirth);

  async function addContact(input: MedicalContactInput) {
    const base = { name: input.name, phone: input.phone, address: input.address, email: input.email };
    if (!user) {
      // No auth session (shouldn't happen once wired end-to-end) — keep it
      // usable locally rather than silently dropping the contact.
      const record = { id: makeId(), ...base };
      if (contactModal === 'emergency')
        setRider({ emergencyContacts: [...rider.emergencyContacts, { ...record, relationship: input.relationship }] });
      else setRider({ medicalContacts: [...rider.medicalContacts, { ...record, specialty: input.specialty, hospital: input.hospital }] });
      return;
    }
    if (contactModal === 'emergency') {
      const emergency = { ...base, relationship: input.relationship };
      const { id, error } = await addEmergencyContact(user.id, emergency);
      setRider({ emergencyContacts: [...rider.emergencyContacts, { id: id ?? makeId(), ...emergency }] });
      if (error) setSaveError(error);
    } else if (contactModal === 'doctor') {
      const { id, error } = await addMedicalContact(user.id, { ...base, specialty: input.specialty, hospital: input.hospital });
      setRider({
        medicalContacts: [...rider.medicalContacts, { id: id ?? makeId(), ...base, specialty: input.specialty, hospital: input.hospital }],
      });
      if (error) setSaveError(error);
    }
  }

  async function removeEmergencyContact(id: string) {
    setRider({ emergencyContacts: rider.emergencyContacts.filter((x) => x.id !== id) });
    await deleteEmergencyContact(id);
  }

  async function removeMedicalContact(id: string) {
    setRider({ medicalContacts: rider.medicalContacts.filter((x) => x.id !== id) });
    await deleteMedicalContact(id);
  }

  async function handleSubmit() {
    if (!user) {
      onSubmit();
      return;
    }
    setSaving(true);
    setSaveError(null);
    const { error } = await saveRiderProfile(user.id, rider);
    setSaving(false);
    if (error) {
      setSaveError(error);
      return;
    }
    onSubmit();
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar
          title={title}
          onBack={onBack}
        />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar initials={initialsFrom(rider.fullName)} size={52} />
              <View style={{ flex: 1 }}>
                <SectionLabel>Who is this profile for?</SectionLabel>
                <Hint>Used to identify this rider to drivers and contacts.</Hint>
              </View>
            </View>
            {labeledInput('Full name', rider.fullName, (v) => setRider({ fullName: v }), 'e.g. Rosa Alvarez')}
            {labeledInput(
              'Date of birth',
              rider.dateOfBirth,
              (v) => setRider({ dateOfBirth: formatDobInput(v) }),
              'MM/DD/YYYY',
              'default',
              dobError
            )}
            {labeledInput(
              'Phone number',
              rider.phone,
              (v) => setRider({ phone: formatPhoneInput(v) }),
              '(555) 000-0000',
              'phone-pad',
              phoneError
            )}
          </Card>

          <Card>
            <SectionLabel>Mobility aid</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {MOBILITY_AIDS.map((aid) => (
                <Chip key={aid} label={aid} selected={rider.mobilityAid === aid} onPress={() => setRider({ mobilityAid: aid })} />
              ))}
            </View>
            {rider.mobilityAid.includes('wheelchair') && (
              <>
                <Divider />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={type.label}>Folds for the trunk?</Text>
                  <View style={{ width: 120 }}>
                    <SegmentedControl options={['Yes', 'No']} value={rider.foldable} onChange={(v) => setRider({ foldable: v })} />
                  </View>
                </View>
                <Hint>If no, we'll only match ramp or lift-equipped vehicles.</Hint>
              </>
            )}
          </Card>

          <Card>
            <SectionLabel>Communication needs</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {COMMUNICATION_NEEDS.map((need) => (
                <Chip
                  key={need}
                  label={need}
                  selected={rider.communicationNeeds.includes(need)}
                  onPress={() => setRider({ communicationNeeds: toggle(rider.communicationNeeds, need) })}
                />
              ))}
            </View>
          </Card>

          <Card>
            <SectionLabel>Assistance needs</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {ASSISTANCE_NEEDS.map((need) => (
                <Chip
                  key={need}
                  label={need}
                  selected={rider.assistanceNeeds.includes(need)}
                  onPress={() => setRider({ assistanceNeeds: toggle(rider.assistanceNeeds, need) })}
                />
              ))}
            </View>
          </Card>

          <Card>
            <Text style={type.label}>Anything drivers should always know?</Text>
            <TextInput
              value={rider.standingNotes}
              onChangeText={(v) => setRider({ standingNotes: v })}
              placeholder="e.g. Always sits in the front seat"
              accessibilityLabel="Anything drivers should always know"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={{
                borderWidth: 1,
                borderColor: colors.borderStrong,
                borderRadius: 12,
                padding: 14,
                fontSize: 16,
                minHeight: 64,
                color: colors.text,
              }}
            />
          </Card>

          <Card>
            <SectionLabel>Help a driver recognize you</SectionLabel>
            <Hint>Drivers see this description at pickup — no photo is collected.</Hint>
            <Text style={type.label}>What you'll look like / be wearing</Text>
            <TextInput
              value={rider.idDescription}
              onChangeText={(v) => setRider({ idDescription: v })}
              placeholder="e.g. Usually wears a blue cardigan"
              accessibilityLabel="What you'll look like or be wearing"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={{
                borderWidth: 1,
                borderColor: colors.borderStrong,
                borderRadius: 12,
                padding: 14,
                fontSize: 16,
                minHeight: 64,
                color: colors.text,
              }}
            />
          </Card>

          <Card>
            <SectionLabel>Emergency contacts</SectionLabel>
            {/* Say plainly who can see these. The driver grant (migration
                0020) is real, so the rider has to know about it before they
                type a family member's number in. */}
            {/* This list has to match what ride_emergency_contacts()
                actually returns (0020, widened by 0025). If the two drift,
                the disclosure becomes a lie — so change them together. */}
            <Hint>
              Your driver can see a contact's name, relationship and number while you're with them — from pickup until
              drop-off, and not after. Never their address or email. We'll tell you if they do. Caregivers who book for
              you never see these.
            </Hint>
            {rider.emergencyContacts.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar initials={initialsFrom(c.name)} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15, color: colors.text }}>{c.name}</Text>
                  <Hint>{[c.relationship, c.phone].filter(Boolean).join(' · ')}</Hint>
                </View>
                <IconButton label={`Remove emergency contact ${c.name}`} onPress={() => removeEmergencyContact(c.id)}>
                  <CloseIcon size={14} />
                </IconButton>
              </View>
            ))}
            <Pressable
              onPress={() => setContactModal('emergency')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <PlusIcon size={16} color={colors.accentDark} />
              <Text style={{ color: colors.accentDark, fontWeight: '700', fontSize: 14 }}>Add emergency contact</Text>
            </Pressable>
          </Card>

          <Card>
            <SectionLabel>Doctors &amp; caretakers (optional)</SectionLabel>
            {/* Deliberately NOT shared with drivers, unlike emergency
                contacts. A specialty and hospital together disclose a
                diagnosis — "Oncology, Cancer Care Alliance" says more about
                someone than they'd choose to tell a stranger driving them to
                the shops — and a driver can't act on it anyway: in a real
                emergency it's 911, and a doctor's office won't discuss a
                patient with a driver. What a driver actually needs is the
                standing note above and an emergency contact. */}
            <Hint>
              Only you can see these — not your driver, and not caregivers who book for you. They're here so your own
              details are in one place. If there's something a driver should do, put it in "Anything drivers should
              always know?" above.
            </Hint>
            {rider.medicalContacts.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar initials={initialsFrom(c.name)} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15, color: colors.text }}>{c.name}</Text>
                  <Hint>
                    {[c.specialty, c.hospital, c.phone].filter(Boolean).join(' · ')}
                  </Hint>
                </View>
                <IconButton label={`Remove ${c.name}`} onPress={() => removeMedicalContact(c.id)}>
                  <CloseIcon size={14} />
                </IconButton>
              </View>
            ))}
            <Pressable onPress={() => setContactModal('doctor')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <PlusIcon size={16} color={colors.accentDark} />
              <Text style={{ color: colors.accentDark, fontWeight: '700', fontSize: 14 }}>Add doctor or caretaker</Text>
            </Pressable>
          </Card>
        </ScrollView>

        <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, gap: 8 }}>
          {saveError && <Text style={{ fontSize: 13, color: colors.alertDark }}>{saveError}</Text>}
          <PrimaryButton label={saving ? 'Saving…' : ctaLabel} onPress={handleSubmit} disabled={!canSubmit || saving} />
        </View>

        <ContactModal
          visible={contactModal !== null}
          variant={contactModal ?? 'emergency'}
          onClose={() => setContactModal(null)}
          onSave={addContact}
        />
      </SafeAreaView>
    </Screen>
  );
}
