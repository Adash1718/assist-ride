import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Avatar, Card, Chip, Hint, IconButton, PrimaryButton, Screen, TopBar } from '../../components/ui';
import { LogOutIcon, PencilIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { useAuth } from '../../contexts/AuthContext';
import { initialsFrom } from '../../lib/format';
import { ensureRiderProfileRow, fetchRiderProfile, isRiderProfileComplete } from '../../lib/profileApi';
import { ACTIVE_RIDE_STATUSES, fetchActiveRideForRider } from '../../lib/rideApi';

export default function RiderHome() {
  const { rider, setRider } = useProfiles();
  const { session, loading, signOut } = useAuth();
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [checking, setChecking] = useState(true);
  const [checkingRide, setCheckingRide] = useState(true);

  const userId = session?.user?.id;

  // Re-verify against the database on every visit here — not just trust
  // whatever ProfileContext happens to hold — so a rider can never reach
  // booking without having actually finished profile setup, regardless of
  // how they got to this URL (deep link, back button, a stale tab). Depends
  // on the user id (a stable primitive), not the whole session object,
  // which Supabase replaces with a new reference on every token refresh —
  // and a transient fetch failure must never be treated the same as "no
  // profile exists" (that would wrongly bounce an already-set-up rider to
  // onboarding).
  useEffect(() => {
    if (loading) return;
    if (!userId) {
      router.replace('/');
      return;
    }
    (async () => {
      const { data, error } = await fetchRiderProfile(userId);
      if (data) setRider(data);
      if (error) {
        setChecking(false);
        return;
      }
      if (!isRiderProfileComplete(data)) {
        if (!data) await ensureRiderProfileRow(userId);
        router.replace('/(onboarding)/rider');
        return;
      }
      setChecking(false);
    })();
  }, [loading, userId]);

  // A rider whose ride is still going — searching, or matched through
  // riding — goes straight back to it instead of seeing "Book a Ride" (and
  // being able to book a second ride on top of it). Runs on every focus,
  // since Home stays mounted under the booking flow pushed on top of it.
  // Completed and cancelled rides aren't "still going", so they don't count.
  useFocusEffect(
    useCallback(() => {
      if (checking || !userId) return;
      let cancelled = false;
      setCheckingRide(true);
      (async () => {
        const { data } = await fetchActiveRideForRider(userId);
        if (cancelled) return;
        if (data && ACTIVE_RIDE_STATUSES.includes(data.status)) {
          router.replace({ pathname: '/(rider)/en-route', params: { rideId: data.id } });
          return;
        }
        if (data) {
          router.replace({ pathname: '/(rider)/matching', params: { rideId: data.id } });
          return;
        }
        setCheckingRide(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [checking, userId])
  );

  const needChips = [rider.mobilityAid !== 'None' ? rider.mobilityAid : null, ...rider.communicationNeeds, ...rider.assistanceNeeds]
    .filter((c): c is string => !!c)
    .slice(0, 3);

  if (checking || checkingRide) return null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar
          title="Assist Ride"
          right={
            <IconButton
              onPress={async () => {
                await signOut();
                router.replace('/');
              }}
            >
              <LogOutIcon />
            </IconButton>
          }
        />

        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg }}>
          {notice === 'cancelled' && (
            <Card style={{ backgroundColor: colors.positiveSoft, borderColor: colors.positive }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.positiveDark }}>Your ride was cancelled</Text>
              <Hint>Book a new ride whenever you're ready.</Hint>
            </Card>
          )}

          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar initials={initialsFrom(rider.fullName)} size={52} />
            <View style={{ flex: 1, marginLeft: spacing.md, gap: 6 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{rider.fullName || 'Set up your profile'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {needChips.length > 0 ? (
                  needChips.map((c) => <Chip key={c} label={c} />)
                ) : (
                  <Hint>No needs on file yet</Hint>
                )}
              </View>
            </View>
            <IconButton onPress={() => router.push('/(rider)/profile')}>
              <PencilIcon size={16} />
            </IconButton>
          </Card>

          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
            <Text style={[type.heading, { color: colors.text }]}>No ride booked yet</Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center' }}>
              When you're ready, book a ride{rider.fullName ? ` for ${rider.fullName.split(' ')[0]}` : ''} below.
            </Text>
          </View>

          <PrimaryButton label="Book a Ride" onPress={() => router.push('/(rider)/book')} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
