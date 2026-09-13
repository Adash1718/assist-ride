import { Text, TextInput, View } from 'react-native';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  Stepper,
  TopBar,
} from './ui';
import { HelpCircleIcon, ShieldIcon } from './Icon';
import { useState } from 'react';
import { useProfiles } from '../contexts/ProfileContext';
import { useAuth } from '../contexts/AuthContext';
import { initialsFrom } from '../lib/format';
import { formatDobInput, formatPhoneInput, isValidDob, isValidPhone } from '../lib/validators';
import { saveDriverProfile } from '../lib/profileApi';

const CAPABILITY_TAGS = [
  'Comfortable assisting transfers',
  'Wheelchair stowage',
  'Patient with cognitive-support riders',
  'Experienced with service animals',
];

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
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

// Shared by onboarding sign-up (create) and the driver-side edit screen —
// same fields either way (SPEC.md §2.3), only the title/CTA/back behavior
// differ. State lives in ProfileContext so it actually shows up on the
// driver's home screen and the rides they're matched to.
export function DriverProfileForm({
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
  const { driver, setDriver } = useProfiles();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const phoneError = driver.phone !== '' && !isValidPhone(driver.phone) ? '10-digit US phone number required' : undefined;
  const dobError = driver.dateOfBirth !== '' && !isValidDob(driver.dateOfBirth) ? 'Enter a valid past date (MM/DD/YYYY)' : undefined;
  const canSubmit =
    driver.fullName.trim() !== '' && driver.licenseNumber.trim() !== '' && isValidPhone(driver.phone) && isValidDob(driver.dateOfBirth);

  async function handleSubmit() {
    if (!user) {
      onSubmit();
      return;
    }
    setSaving(true);
    setSaveError(null);
    const { error } = await saveDriverProfile(user.id, driver);
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
          right={
            <IconButton>
              <HelpCircleIcon />
            </IconButton>
          }
        />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar initials={initialsFrom(driver.fullName)} size={52} />
              <View style={{ flex: 1 }}>
                <SectionLabel>Your identity</SectionLabel>
                <Hint>Verified against your license before you can go available.</Hint>
              </View>
            </View>
            {labeledInput('Full legal name', driver.fullName, (v) => setDriver({ fullName: v }), 'e.g. James O’Connor')}
            {labeledInput(
              'Date of birth',
              driver.dateOfBirth,
              (v) => setDriver({ dateOfBirth: formatDobInput(v) }),
              'MM/DD/YYYY',
              'default',
              dobError
            )}
            {labeledInput(
              'Phone number',
              driver.phone,
              (v) => setDriver({ phone: formatPhoneInput(v) }),
              '(555) 000-0000',
              'phone-pad',
              phoneError
            )}
            {labeledInput('Driver’s license number', driver.licenseNumber, (v) => setDriver({ licenseNumber: v }), 'e.g. D1234567')}
          </Card>

          <Card>
            <SectionLabel>Vehicle</SectionLabel>
            {labeledInput('Make, model & color', driver.vehicle, (v) => setDriver({ vehicle: v }), 'e.g. Honda Odyssey, Silver')}
            {labeledInput('License plate', driver.plate, (v) => setDriver({ plate: v }), 'e.g. 7GHT291')}
            <Divider />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={type.label}>Wheelchair ramp or lift?</Text>
                <Hint>Required to match non-folding wheelchair riders</Hint>
              </View>
              <View style={{ width: 120 }}>
                <SegmentedControl options={['Yes', 'No']} value={driver.rampEquipped} onChange={(v) => setDriver({ rampEquipped: v })} />
              </View>
            </View>
          </Card>

          <Card>
            <SectionLabel>Assistance capabilities</SectionLabel>
            <Hint>Self-reported for now — riders will rate this after each trip.</Hint>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {CAPABILITY_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  selected={driver.capabilityTags.includes(tag)}
                  onPress={() => setDriver({ capabilityTags: toggle(driver.capabilityTags, tag) })}
                />
              ))}
            </View>
          </Card>

          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={type.label}>Companion seats</Text>
                <Hint>Riders alongside the assistance rider (not counting them)</Hint>
              </View>
              <Stepper value={driver.companionSeats} onChange={(v) => setDriver({ companionSeats: v })} min={0} max={6} />
            </View>
          </Card>

          <Card>
            <SectionLabel>Certifications (optional)</SectionLabel>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                borderWidth: 1.5,
                borderColor: colors.border,
                borderStyle: 'dashed',
                borderRadius: 14,
                padding: spacing.md,
                backgroundColor: colors.surfaceAlt,
              }}
            >
              <ShieldIcon color={colors.textTertiary} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textTertiary, flex: 1 }}>
                Add a caregiving, CPR, or transport certification
              </Text>
            </View>
          </Card>

          <Card>
            <Hint>
              Background check status: not started. A verification step will be added before drivers can go live — this is a
              placeholder for now.
            </Hint>
          </Card>
        </ScrollView>

        <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
          {saveError && <Text style={{ fontSize: 13, color: colors.alertDark, marginBottom: 8 }}>{saveError}</Text>}
          <PrimaryButton label={saving ? 'Saving…' : ctaLabel} onPress={handleSubmit} disabled={!canSubmit || saving} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
