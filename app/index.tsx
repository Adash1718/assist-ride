import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../constants/theme';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { CarIcon, ShieldIcon, UsersIcon } from '../components/Icon';
import { useAuth } from '../contexts/AuthContext';
import { useProfiles } from '../contexts/ProfileContext';
import {
  ensureDriverProfileRow,
  ensureRiderProfileRow,
  fetchDriverProfile,
  fetchRiderProfile,
  isDriverProfileComplete,
  isRiderProfileComplete,
} from '../lib/profileApi';

export default function Welcome() {
  const { session, role, loading } = useAuth();
  const { setRider, setDriver } = useProfiles();
  const [checkingSession, setCheckingSession] = useState(true);

  // If a session already exists (returning to the app without signing out,
  // or landing here after clicking an email confirmation link), route by
  // whether the profile is actually filled out — never drop an
  // authenticated-but-not-yet-set-up rider/driver straight into
  // booking/availability.
  useEffect(() => {
    if (loading) return;
    if (!session) {
      setCheckingSession(false);
      return;
    }
    (async () => {
      if (role === 'driver') {
        const { data } = await fetchDriverProfile(session.user.id);
        if (data) setDriver(data);
        if (isDriverProfileComplete(data)) {
          router.replace('/(driver)/driver-home');
        } else {
          if (!data) await ensureDriverProfileRow(session.user.id);
          router.replace('/(onboarding)/driver');
        }
      } else {
        const { data } = await fetchRiderProfile(session.user.id);
        if (data) setRider(data);
        if (isRiderProfileComplete(data)) {
          router.replace('/(rider)/home');
        } else {
          if (!data) await ensureRiderProfileRow(session.user.id);
          router.replace('/(onboarding)/rider');
        }
      }
    })();
  }, [loading, session, role]);

  if (loading || checkingSession) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, padding: spacing.xl, justifyContent: 'space-between' }}>
        <View style={{ gap: spacing.lg, paddingTop: spacing.xl }}>
          <View style={{ gap: spacing.xs }}>
            <Text style={[type.heading, { fontSize: 28, color: colors.text }]}>Assist Ride</Text>
            <Text style={{ fontSize: 16, color: colors.textSecondary, lineHeight: 22 }}>
              Rides built for people who need a little more help getting there — and drivers ready to give it.
            </Text>
          </View>

          <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
            <PitchRow
              icon={<UsersIcon size={20} color={colors.accentDark} />}
              text="Set up a profile once with mobility, communication, and assistance needs — every driver sees it before they arrive."
            />
            <PitchRow
              icon={<ShieldIcon size={20} color={colors.accentDark} />}
              text="Drivers share their vehicle and assistance capabilities up front, so every match is a real fit."
            />
            <PitchRow
              icon={<CarIcon size={20} color={colors.accentDark} />}
              text="Book for yourself, or as a caregiver booking on behalf of someone else."
            />
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <PrimaryButton label="Sign up as a Rider" onPress={() => router.push({ pathname: '/(auth)/sign-up', params: { role: 'rider' } })} />
          <SecondaryButton
            label="Sign up as a Driver"
            onPress={() => router.push({ pathname: '/(auth)/sign-up', params: { role: 'driver' } })}
          />
          <Pressable onPress={() => router.push('/(auth)/sign-in')} style={{ alignItems: 'center', paddingTop: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.textSecondary }}>Already have an account? Log in</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function PitchRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
          flex: 0,
        }}
      >
        {icon}
      </View>
      <Text style={{ flex: 1, fontSize: 14, color: colors.textSecondary, lineHeight: 20, paddingTop: 8 }}>{text}</Text>
    </View>
  );
}
