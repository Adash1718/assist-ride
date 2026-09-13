import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Card, Hint, PrimaryButton, Screen, SecondaryButton, SectionLabel } from '../../components/ui';
import { CameraIcon, MapPinIcon, UsersIcon } from '../../components/Icon';
import { useAuth } from '../../contexts/AuthContext';
import { acceptRideRequest, declineRideRequest, fetchRideRequest, RideRequestData } from '../../lib/rideApi';

// SPEC.md §4: driver accept/decline window is 45s (not the near-instant
// window of a standard rideshare) — a driver here needs time to actually
// read the rider's needs before committing.
const ACCEPT_WINDOW_SECONDS = 45;

export default function DriverIncoming() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { user } = useAuth();
  const [ride, setRide] = useState<RideRequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ACCEPT_WINDOW_SECONDS);

  useEffect(() => {
    if (!rideId) return;
    (async () => {
      const { data } = await fetchRideRequest(rideId);
      setRide(data);
      setLoading(false);
    })();
  }, [rideId]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      // Window expired — counts as a decline (not just "go back and wait"),
      // otherwise the very next catch-up check on Driver Home would find
      // this exact same still-open ride and immediately re-show it, looping
      // forever on one ride this driver has already effectively passed on.
      (async () => {
        if (rideId && user) await declineRideRequest(rideId, user.id);
        router.replace('/(driver)/driver-home');
      })();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');

  const needs = ride
    ? [ride.needsSnapshot.mobilityAid !== 'None' ? ride.needsSnapshot.mobilityAid : null, ...ride.needsSnapshot.communicationNeeds, ...ride.needsSnapshot.assistanceNeeds].filter(
        (n): n is string => !!n
      )
    : [];
  const description = ride?.needsSnapshot.idDescription.trim() || 'No description on file.';

  async function handleAccept() {
    if (!rideId || !user) return;
    setResponding(true);
    setError(null);
    const { error: err } = await acceptRideRequest(rideId, user.id);
    setResponding(false);
    if (err) {
      // Most likely another driver claimed it first — see SPEC.md, no
      // reassignment loop yet, so just send this driver back to waiting.
      setError('This ride was just taken by another driver.');
      setTimeout(() => router.replace('/(driver)/driver-home'), 1500);
      return;
    }
    router.replace('/(driver)/driver-home');
  }

  async function handleDecline() {
    if (rideId && user) await declineRideRequest(rideId, user.id);
    router.replace('/(driver)/driver-home');
  }

  if (loading || !ride) return null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ flex: 1, fontSize: 19, fontWeight: '700', color: colors.text }}>New Ride Request</Text>
          <View style={{ backgroundColor: colors.alertSoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.alertDark }}>
              {mm}:{ss}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {error && (
            <Card style={{ backgroundColor: colors.alertSoft, borderColor: colors.alert }}>
              <Hint>{error}</Hint>
            </Card>
          )}

          <Card style={{ borderColor: colors.accent, backgroundColor: colors.accentSoft }}>
            <SectionLabel>Rider needs</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {needs.length > 0 ? (
                needs.map((tag) => (
                  <View
                    key={tag}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 18,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.accent,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.accentDark }}>{tag}</Text>
                  </View>
                ))
              ) : (
                <Hint>No specific needs on file.</Hint>
              )}
            </View>
          </Card>

          <Card>
            <SectionLabel>Recognizing the rider</SectionLabel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 12,
                  backgroundColor: colors.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CameraIcon color={colors.textTertiary} />
              </View>
              <Text style={{ flex: 1, fontSize: 13.5, color: colors.textSecondary, lineHeight: 19 }}>{description}</Text>
            </View>
          </Card>

          <Card>
            {ride.companionCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <UsersIcon size={18} color={colors.textTertiary} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>
                  +{ride.companionCount} companion{ride.companionCount > 1 ? 's' : ''} riding along
                </Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MapPinIcon size={18} color={colors.textTertiary} />
              <Text style={{ fontSize: 14, color: colors.text }}>{ride.pickup}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MapPinIcon size={18} color={colors.textTertiary} />
              <Text style={{ fontSize: 14, color: colors.text }}>{ride.dropoff}</Text>
            </View>
            {ride.rideNotes.trim() !== '' && <Hint>"{ride.rideNotes}"</Hint>}
          </Card>
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            gap: 12,
            padding: spacing.lg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <SecondaryButton label="Decline" onPress={handleDecline} />
          <View style={{ flex: 1 }}>
            <PrimaryButton label={responding ? 'Accepting…' : 'Accept'} onPress={handleAccept} disabled={responding} />
          </View>
        </View>
      </SafeAreaView>
    </Screen>
  );
}
