import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Card, Hint, PrimaryButton, Screen, SecondaryButton } from '../../components/ui';
import { RecognizeRiderCard, RiderNeedsCard, TripCard } from '../../components/RideCards';
import { useAuth } from '../../contexts/AuthContext';
import { acceptRideRequest, declineRideRequest, fetchRideRequest, RideRequestData } from '../../lib/rideApi';

// SPEC.md §4: driver accept/decline window is 45s (not the near-instant
// window of a standard rideshare) — a driver here needs time to actually
// read the rider's needs before committing.
const ACCEPT_WINDOW_SECONDS = 45;

// How often to re-check that the offer is still open (see below).
const STILL_OPEN_CHECK_MS = 2000;

// Back to the Driver Home this screen was pushed from (rather than stacking
// a new one) — its focus effect then resumes matching, or redirects to the
// driver's active ride if they have one.
function backToDriverHome() {
  router.dismissTo('/(driver)/driver-home');
}

export default function DriverIncoming() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { user } = useAuth();
  const [ride, setRide] = useState<RideRequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The ride stopped being available while this driver was reading it.
  const [gone, setGone] = useState(false);
  const deadline = useRef(Date.now() + ACCEPT_WINDOW_SECONDS * 1000);
  const [secondsLeft, setSecondsLeft] = useState(ACCEPT_WINDOW_SECONDS);

  useEffect(() => {
    if (!rideId) return;
    (async () => {
      const { data, error: err } = await fetchRideRequest(rideId);
      setRide(data);
      if (!err && !data) setGone(true); // already gone before this screen loaded
      setLoading(false);
    })();
  }, [rideId]);

  // Is the offer still open? Realtime can't tell this screen: once the rider
  // cancels or another driver claims the ride, RLS hides the row from this
  // driver, and Realtime (which checks the SELECT policy per subscriber)
  // drops the event instead of delivering it. So re-check every couple of
  // seconds — an empty result, or a status that's moved on to someone else,
  // means it's gone.
  useEffect(() => {
    if (!rideId || gone) return;
    const t = setInterval(async () => {
      const { data, error: err } = await fetchRideRequest(rideId);
      if (err) return; // transient — try again next tick
      if (!data || (data.status !== 'requested' && data.matchedDriverId !== user?.id)) setGone(true);
    }, STILL_OPEN_CHECK_MS);
    return () => clearInterval(t);
  }, [rideId, gone, user?.id]);

  useEffect(() => {
    if (!gone) return;
    const t = setTimeout(backToDriverHome, 2500);
    return () => clearTimeout(t);
  }, [gone]);

  // Counts down to a fixed deadline instead of chaining 1s timeouts:
  // browsers throttle timers in background tabs (a chained countdown was
  // measured at ~1.6s per "second"), which silently stretched the 45s
  // window. Each tick just re-reads the clock, so a late tick can't add
  // time. (Still client-side — the server doesn't enforce the window yet.)
  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (secondsLeft > 0 || gone) return;
    // Window expired — counts as a decline (not just "go back and wait"),
    // otherwise the very next catch-up check on Driver Home would find this
    // exact same still-open ride and immediately re-show it, looping forever
    // on one ride this driver has already effectively passed on.
    (async () => {
      if (rideId && user) await declineRideRequest(rideId, user.id);
      backToDriverHome();
    })();
  }, [secondsLeft]);

  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');

  async function handleAccept() {
    if (!rideId || !user) return;
    setResponding(true);
    setError(null);
    const { error: err } = await acceptRideRequest(rideId, user.id);
    setResponding(false);
    if (err) {
      // Another driver claimed it first, the rider cancelled, or this driver
      // already has an active ride — back to Driver Home, which surfaces the
      // next open ride (or the active one).
      setError(err);
      setTimeout(backToDriverHome, 1500);
      return;
    }
    router.replace({ pathname: '/(driver)/active-ride', params: { rideId } });
  }

  async function handleDecline() {
    if (!rideId || !user) return;
    setResponding(true);
    setError(null);
    const { error: err } = await declineRideRequest(rideId, user.id);
    setResponding(false);
    if (err) {
      // Stay here rather than going back — an unrecorded decline means Driver
      // Home's catch-up fetch would just re-show this same ride.
      setError("Couldn't decline this ride. Please try again.");
      return;
    }
    backToDriverHome();
  }

  if (loading) return null;

  const goneNotice = (
    <Card style={{ backgroundColor: colors.alertSoft, borderColor: colors.alert }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: colors.alertDark }}>This ride is no longer available</Text>
      <Hint>The rider cancelled it or another driver accepted it. Taking you back to Driver Home…</Hint>
    </Card>
  );

  if (!ride) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: spacing.lg }} edges={['top', 'bottom']}>
          {goneNotice}
        </SafeAreaView>
      </Screen>
    );
  }

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
          {!gone && (
            <View style={{ backgroundColor: colors.alertSoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.alertDark }}>
                {mm}:{ss}
              </Text>
            </View>
          )}
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {gone && goneNotice}
          {!gone && error && (
            <Card style={{ backgroundColor: colors.alertSoft, borderColor: colors.alert }}>
              <Hint>{error}</Hint>
            </Card>
          )}

          <RiderNeedsCard ride={ride} />
          <RecognizeRiderCard ride={ride} />
          <TripCard ride={ride} />
        </ScrollView>

        {!gone && (
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
        )}
      </SafeAreaView>
    </Screen>
  );
}
