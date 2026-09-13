import { useState } from 'react';
import { router } from 'expo-router';
import { Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { PrimaryButton, Screen, TopBar } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useProfiles } from '../../contexts/ProfileContext';
import {
  ensureDriverProfileRow,
  ensureRiderProfileRow,
  fetchDriverProfile,
  fetchRiderProfile,
  isDriverProfileComplete,
  isRiderProfileComplete,
} from '../../lib/profileApi';
import { supabase } from '../../lib/supabase';

export default function SignIn() {
  const { signIn } = useAuth();
  const { setRider, setDriver } = useProfiles();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    if (result.error) {
      setSubmitting(false);
      setError(result.error);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    const role = (user?.user_metadata?.role as 'rider' | 'driver' | undefined) ?? 'rider';

    if (role === 'rider') {
      const { data } = await fetchRiderProfile(user!.id);
      if (data) setRider(data);
      if (isRiderProfileComplete(data)) {
        router.replace('/(rider)/home');
      } else {
        if (!data) await ensureRiderProfileRow(user!.id); // e.g. confirmed email but never finished setup
        router.replace('/(onboarding)/rider');
      }
    } else {
      const { data } = await fetchDriverProfile(user!.id);
      if (data) setDriver(data);
      if (isDriverProfileComplete(data)) {
        router.replace('/(driver)/driver-home');
      } else {
        if (!data) await ensureDriverProfileRow(user!.id);
        router.replace('/(onboarding)/driver');
      }
    }
    setSubmitting(false);
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title="Log In" onBack={() => router.back()} />

        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
          <Text style={type.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 16, color: colors.text }}
          />

          <Text style={type.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 16, color: colors.text }}
          />

          {error && <Text style={{ fontSize: 13, color: colors.alertDark }}>{error}</Text>}

          <PrimaryButton
            label={submitting ? 'Logging in…' : 'Log In'}
            onPress={handleSubmit}
            disabled={submitting || email.trim() === '' || password === ''}
          />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
