import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { backOr } from '../../lib/nav';
import { Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { PrimaryButton, Screen, TopBar } from '../../components/ui';
import { useAuth, Role } from '../../contexts/AuthContext';
import { ensureDriverProfileRow, ensureRiderProfileRow } from '../../lib/profileApi';
import { supabase } from '../../lib/supabase';

export default function SignUp() {
  const params = useLocalSearchParams<{ role?: string }>();
  const role: Role = params.role === 'driver' ? 'driver' : 'rider';
  const { signUp } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  const canSubmit = email.trim() !== '' && password.length >= 6 && password === confirmPassword;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    const result = await signUp(email.trim(), password, role);
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.needsEmailConfirm) {
      setNeedsEmailConfirm(true);
      return;
    }

    // Session is live immediately (email confirmation off) — create the bare
    // profile row now so contacts have something to reference, then head
    // into the role-specific create-profile form.
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (userId) {
      if (role === 'rider') await ensureRiderProfileRow(userId);
      else await ensureDriverProfileRow(userId);
    }
    router.replace(role === 'rider' ? '/(onboarding)/rider' : '/(onboarding)/driver');
  }

  if (needsEmailConfirm) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <TopBar title="Check your email" onBack={() => backOr('/')} />
          <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
            <Text style={[type.heading, { color: colors.text }]}>Confirm your email</Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>
              We sent a confirmation link to {email}. Click it, then come back and log in.
            </Text>
            <PrimaryButton label="Go to Log In" onPress={() => router.replace('/(auth)/sign-in')} />
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title={role === 'rider' ? 'Rider Sign Up' : 'Driver Sign Up'} onBack={() => backOr('/')} />

        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
          <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>
            Create an account, then you'll set up your {role} profile.
          </Text>

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
            placeholder="At least 6 characters"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 16, color: colors.text }}
          />

          <Text style={type.label}>Confirm password</Text>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Re-enter password"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            style={{
              borderWidth: 1,
              borderColor: confirmPassword !== '' && confirmPassword !== password ? colors.alert : colors.border,
              borderRadius: 12,
              padding: 14,
              fontSize: 16,
              color: colors.text,
            }}
          />
          {confirmPassword !== '' && confirmPassword !== password && (
            <Text style={{ fontSize: 12.5, color: colors.alertDark }}>Passwords don't match</Text>
          )}

          {error && <Text style={{ fontSize: 13, color: colors.alertDark }}>{error}</Text>}

          <PrimaryButton
            label={submitting ? 'Creating account…' : 'Create Account'}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
          />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
