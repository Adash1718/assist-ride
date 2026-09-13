import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Card, Hint, PrimaryButton, Screen, SectionLabel } from '../../components/ui';
import { CheckIcon, ClockIcon } from '../../components/Icon';
import { RecognizeRiderCard, RiderNeedsCard, TripCard } from '../../components/RideCards';
import { advanceRideStatus, fetchRideRequest, newerRide, RideRequestData, RideStatus, subscribeToRide } from '../../lib/rideApi';

// The driver's side of a matched ride (SPEC.md §3.D–G): drive to pickup →
// arrive → confirm the rider's PIN → ride → complete. Driver Home sends a
// driver here whenever they have an active ride and offers them no new
// requests until it ends, so this is where every matched driver lands.

type Step = { status: RideStatus; label: string; action: string; next: RideStatus };

const STEPS: Step[] = [
  { status: 'matched', label: 'Ride accepted', action: 'Start driving to pickup', next: 'driver_en_route' },
  { status: 'driver_en_route', label: 'Driving to pickup', action: "I've arrived at pickup", next: 'arrived' },
  { status: 'arrived', label: 'At pickup — confirm PIN', action: 'Confirm PIN & start ride', next: 'in_progress' },
  { status: 'in_progress', label: 'Ride in progress', action: 'Complete ride', next: 'completed' },
];

function backToDriverHome() {
  router.dismissTo('/(driver)/driver-home');
}

export default function ActiveRide() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [ride, setRide] = useState<RideRequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pinEntry, setPinEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rideId) return;
    // Subscribe before fetching so an update landing in between isn't lost.
    const unsubscribe = subscribeToRide(rideId, (updated) => setRide((prev) => newerRide(prev, updated)));
    (async () => {
      const { data } = await fetchRideRequest(rideId);
      if (!data) {
        backToDriverHome();
        return;
      }
      setRide((prev) => newerRide(prev, data));
      setLoading(false);
    })();
    return unsubscribe;
  }, [rideId]);

  // The rider cancelled (pushed live via the subscription above).
  const cancelled = ride?.status === 'cancelled';
  useEffect(() => {
    if (!cancelled) return;
    const t = setTimeout(backToDriverHome, 2500);
    return () => clearTimeout(t);
  }, [cancelled]);

  const currentIndex = STEPS.findIndex((s) => s.status === ride?.status);
  const step = currentIndex >= 0 ? STEPS[currentIndex] : null;

  async function advance() {
    if (!ride || !step) return;
    setError(null);
    // Checked on this device against the ride's PIN — enough to catch picking
    // up the wrong person, but the driver's client can read the PIN, so real
    // verification would need a server-side check (later hardening).
    if (step.status === 'arrived' && pinEntry !== ride.pin) {
      setError("That PIN doesn't match. Ask the rider to read the PIN shown in their app.");
      return;
    }
    setBusy(true);
    const { data, error: err } = await advanceRideStatus(ride.id, step.status, step.next);
    setBusy(false);
    if (err || !data) {
      setError(err ?? 'Something went wrong. Please try again.');
      return;
    }
    if (data.status === 'completed') {
      backToDriverHome();
      return;
    }
    setRide((prev) => newerRide(prev, data));
  }

  if (loading || !ride) return null;

  const pillLabel = cancelled ? 'Cancelled' : step?.label ?? '';

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
          <Text style={{ flex: 1, fontSize: 19, fontWeight: '700', color: colors.text }}>Active Ride</Text>
          <View
            style={{
              backgroundColor: cancelled ? colors.alertSoft : colors.positiveSoft,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 10,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: cancelled ? colors.alertDark : colors.positiveDark }}>{pillLabel}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {cancelled && (
            <Card style={{ backgroundColor: colors.alertSoft, borderColor: colors.alert }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.alertDark }}>The rider cancelled this ride.</Text>
              <Hint>Taking you back to Driver Home…</Hint>
            </Card>
          )}

          {!cancelled && (
            <Card>
              <SectionLabel>Progress</SectionLabel>
              {STEPS.map((s, i) => (
                <ProgressRow key={s.status} label={s.label} state={i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo'} />
              ))}
            </Card>
          )}

          <RiderNeedsCard ride={ride} />
          <RecognizeRiderCard ride={ride} />
          <TripCard ride={ride} />
        </ScrollView>

        {step && !cancelled && (
          <View
            style={{
              padding: spacing.lg,
              gap: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            {error && <Hint>{error}</Hint>}
            {step.status === 'arrived' && (
              <TextInput
                value={pinEntry}
                onChangeText={(t) => setPinEntry(t.replace(/\D/g, '').slice(0, 4))}
                placeholder="Rider's 4-digit PIN"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                maxLength={4}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  padding: 14,
                  fontSize: 20,
                  letterSpacing: 6,
                  textAlign: 'center',
                  color: colors.text,
                  backgroundColor: colors.surface,
                }}
              />
            )}
            <PrimaryButton
              label={busy ? 'Updating…' : step.action}
              onPress={advance}
              disabled={busy || (step.status === 'arrived' && pinEntry.length !== 4)}
            />
          </View>
        )}
      </SafeAreaView>
    </Screen>
  );
}

function ProgressRow({ label, state }: { label: string; state: 'done' | 'current' | 'todo' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: state === 'done' ? colors.positiveSoft : state === 'current' ? colors.accentSoft : colors.surfaceAlt,
        }}
      >
        {state === 'done' ? (
          <CheckIcon size={14} color={colors.positiveDark} />
        ) : (
          <ClockIcon size={13} color={state === 'current' ? colors.accentDark : colors.textTertiary} />
        )}
      </View>
      <Text style={{ fontSize: 14, fontWeight: state === 'current' ? '700' : '600', color: state === 'todo' ? colors.textSecondary : colors.text }}>
        {label}
      </Text>
    </View>
  );
}
