import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Avatar, Card, Chip, Hint, IconButton, PrimaryButton, Screen, SecondaryButton, TopBar } from '../../components/ui';
import { ClockIcon } from '../../components/Icon';
import { EmergencyAccessNotice } from '../../components/RideCards';
import { useProfiles } from '../../contexts/ProfileContext';
import { initialsFrom } from '../../lib/format';
import {
  cancelRideRequest,
  CancelQuote,
  fetchCancelQuote,
  fetchMatchedDriver,
  fetchRidePin,
  reissueRidePin,
  formatFee,
  LATE_CANCEL_FEE_CENTS,
  MatchedDriverInfo,
  RideStatus,
} from '../../lib/rideApi';
import { useLiveRide } from '../../lib/useLiveRide';
import { fetchDriverLocationForRide } from '../../lib/locationApi';
import { formatDuration, route, RouteInfo } from '../../lib/geoApi';

// The rider's live view of a matched ride: follows the driver's progress
// (on the way → arrived → riding) via Realtime as the driver advances it on
// their active-ride screen, and moves to the completion screen when the
// driver completes the ride. If the driver hands the ride back before
// pickup, it's back in the search: say so, then return to Matching.
const STATUS_COPY: Partial<Record<RideStatus, { title: string; pill: string; banner: string }>> = {
  requested: { title: 'Finding A New Driver', pill: 'Searching', banner: 'Finding you a new driver' },
  matched: { title: 'Driver Assigned', pill: 'Matched', banner: 'Getting ready to leave' },
  driver_en_route: { title: 'Driver On The Way', pill: 'En route', banner: 'On the way' },
  arrived: { title: 'Your Driver Is Here', pill: 'Arrived', banner: 'Your driver has arrived' },
  in_progress: { title: 'Ride In Progress', pill: 'Riding', banner: 'Heading to your dropoff' },
};

// Long enough to read the "your driver had to cancel" message before going
// back to the search, not so long it feels stuck.
const DRIVER_CANCEL_NOTICE_MS = 4000;
const TICK_MS = 15000;
// The driver is moving, so a stale ETA is a wrong ETA. Often enough to stay
// honest, rare enough not to hammer the public router.
const DRIVER_ETA_REFRESH_MS = 30000;

export default function DriverEnRoute() {
  const { rider } = useProfiles();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { ride, loading } = useLiveRide(rideId);
  const [driverInfo, setDriverInfo] = useState<MatchedDriverInfo | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [quote, setQuote] = useState<CancelQuote | null>(null);
  const [now, setNow] = useState(Date.now());
  const [eta, setEta] = useState<RouteInfo | null>(null);
  const [reissuing, setReissuing] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);

  // Kept after a driver cancel clears matched_driver_id, so the message can
  // say who cancelled; replaced when a new driver is matched.
  const matchedDriverId = ride?.matchedDriverId;
  useEffect(() => {
    if (!matchedDriverId || !rideId) return;
    (async () => {
      const { data } = await fetchMatchedDriver(rideId);
      if (data) setDriverInfo(data);
    })();
  }, [matchedDriverId, rideId]);

  // The pin lives in its own table now (0018) — this side can read it, the
  // driver's side can't.
  useEffect(() => {
    if (!rideId) return;
    (async () => {
      const { data } = await fetchRidePin(rideId);
      if (data) setPin(data);
    })();
  }, [rideId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // What a cancellation costs, straight from the function that does the
  // charging (0021). Re-asked when the ride changes hands or moves on, since
  // both can change the answer. Never computed here: this screen having its
  // own copy of the rule is exactly what made it promise "free" on a ride the
  // server charged for.
  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    (async () => {
      const { data } = await fetchCancelQuote(rideId);
      if (!cancelled && data) setQuote(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId, matchedDriverId, ride?.status]);

  // How far away the driver actually is: their live position (0024, only
  // shared while they're on the way to us) routed against the pickup (0023).
  // Every part is optional — sharing off, position stale, address never
  // geocoded, router down — and any of them means no ETA is shown at all
  // rather than a guess.
  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    const check = async () => {
      const { data: point } = await fetchDriverLocationForRide(rideId);
      if (cancelled) return;
      if (!point || !ride?.pickupPoint) {
        setEta(null);
        return;
      }
      const leg = await route({ lat: point.lat, lng: point.lng, label: '' }, ride.pickupPoint);
      if (!cancelled) setEta(leg);
    };
    void check();
    const t = setInterval(check, DRIVER_ETA_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [rideId, ride?.pickupPoint?.lat, ride?.status]);

  const status = ride?.status;
  useEffect(() => {
    if (leaving.current) return;
    if (!loading && !ride) {
      leaving.current = true;
      router.replace('/(rider)/home');
    } else if (status === 'completed') {
      leaving.current = true;
      router.replace({ pathname: '/(rider)/complete', params: { rideId } });
    } else if (status === 'no_show') {
      leaving.current = true;
      router.replace({ pathname: '/(rider)/home', params: { notice: 'no_show', fee: String(ride?.feeCents ?? 0) } });
    } else if (status === 'cancelled') {
      leaving.current = true;
      router.replace({ pathname: '/(rider)/home', params: { notice: 'cancelled', fee: String(ride?.feeCents ?? 0) } });
    } else if (status === 'requested') {
      // The driver handed the ride back before pickup (driver_cancel_ride) —
      // still booked, back in the search. Matching picks it back up.
      const t = setTimeout(() => {
        if (leaving.current) return;
        leaving.current = true;
        router.replace({ pathname: '/(rider)/matching', params: { rideId, notice: 'driver_cancelled' } });
      }, DRIVER_CANCEL_NOTICE_MS);
      return () => clearTimeout(t);
    }
  }, [status, loading, ride]);

  // The server's own deadline, not one derived from a local copy of the rule.
  const graceEndsAt = quote?.freeUntil ?? null;
  const graceMinutesLeft = graceEndsAt === null ? null : Math.max(0, Math.ceil((graceEndsAt - now) / 60000));
  // A fee the server has already quoted outranks the countdown: if it says
  // there's a charge, say so even if the local clock hasn't caught up.
  const quotedFeeCents = quote?.feeCents ?? 0;

  async function handleCancel() {
    if (!rideId) return;
    // Past the grace window — or whenever we can't prove we're inside it —
    // there's a real cost, so make it a deliberate second tap rather than
    // something to fat-finger. `now` is read fresh here rather than from
    // state: a throttled background tab can leave that state minutes behind,
    // which used to skip this confirmation entirely and cancel on one tap
    // while the server charged the late fee.
    const proveFree = quotedFeeCents === 0 && graceEndsAt !== null && Date.now() <= graceEndsAt;
    if (!proveFree && !confirmingCancel) {
      setConfirmingCancel(true);
      return;
    }
    leaving.current = true; // our own cancel's Realtime echo mustn't navigate a second time
    setCancelling(true);
    setError(null);
    const { data, error: err } = await cancelRideRequest(rideId);
    setCancelling(false);
    if (err) {
      leaving.current = false;
      setConfirmingCancel(false);
      setError(err);
      return;
    }
    router.replace({ pathname: '/(rider)/home', params: { notice: 'cancelled', fee: String(data?.feeCents ?? 0) } });
  }

  async function handleNewPin() {
    if (!rideId || reissuing) return;
    setReissuing(true);
    setPinError(null);
    const { data, error: err } = await reissueRidePin(rideId);
    setReissuing(false);
    if (err) {
      setPinError(err);
      return;
    }
    if (data) setPin(data);
  }

  const copy = (status && STATUS_COPY[status]) || STATUS_COPY.matched!;
  const riding = status === 'in_progress';
  const driverCancelled = status === 'requested';
  // Splitting the fallback on a space produced "Your had to cancel" and
  // "Your will confirm this" — the driver's details aren't loaded yet on a
  // fresh open, or are gone entirely after a hand-back clears
  // matched_driver_id. Fall back to a phrase that reads as one, with a
  // capitalised form for the starts of sentences.
  const driverKnown = !!driverInfo?.fullName.trim();
  const driverName = driverKnown ? driverInfo!.fullName.trim() : 'Your driver';
  const driverFirstName = driverKnown ? driverName.split(' ')[0] : 'your driver';
  const DriverFirstName = driverKnown ? driverName.split(' ')[0] : 'Your driver';
  const vehicleLine = driverInfo?.vehicle.trim()
    ? `${driverInfo.vehicle} · ${driverInfo.rampEquipped === 'Yes' ? 'Wheelchair ramp van' : 'No ramp/lift'} · Plate ${driverInfo.plate || '—'}`
    : 'Vehicle details unavailable';
  const driverTags = driverInfo?.capabilityTags ?? [];
  const riderFirst = rider.fullName.trim().split(' ')[0];
  const riderFirstName = riderFirst || 'the rider';
  const pinDigits = (pin ?? '----').split('');

  if (loading || !ride) return null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar
          title={copy.title}
          // Deliberately not backOr(): plain history could land on Home
          // without `stay`, whose focus effect would bounce straight back
          // here. The ride keeps running either way.
          onBack={() => router.replace({ pathname: '/(rider)/home', params: { stay: '1' } })}
          right={
            <View
              style={{
                backgroundColor: driverCancelled ? colors.alertSoft : colors.positiveSoft,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 10,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: driverCancelled ? colors.alertDark : colors.positiveDark }}>{copy.pill}</Text>
            </View>
          }
        />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {rideId && <EmergencyAccessNotice rideId={rideId} />}
          {driverCancelled && (
            <Card style={{ backgroundColor: colors.alertSoft, borderColor: colors.alert }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.alertDark }}>{DriverFirstName} had to cancel</Text>
              <Text style={{ fontSize: 14, color: colors.text, lineHeight: 20 }}>
                Your ride is still booked — we're finding a new driver{riderFirst ? ` for ${riderFirst}` : ''} now. You don't need to do anything.
              </Text>
              <Hint>Taking you back to the search…</Hint>
            </Card>
          )}

          <View
            style={{
              height: 170,
              borderRadius: 16,
              backgroundColor: colors.surfaceAlt,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 12,
            }}
          >
            <View
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <ClockIcon size={14} color={colors.text} />
              {/* The one thing a rider who can't see the screen most needs:
                  "your driver has arrived" has to ANNOUNCE itself, not sit
                  there waiting to be found. polite, so it doesn't cut across
                  whatever they're reading. */}
              <Text
                style={{ fontSize: 13, fontWeight: '700', color: colors.text }}
                accessibilityLiveRegion="polite"
                accessibilityRole="text"
              >
                {/* A real routed ETA from the driver's live position, or the
                    plain status. Never both invented — if we don't know where
                    they are, we don't claim to. */}
                {eta && (status === 'matched' || status === 'driver_en_route')
                  ? `About ${formatDuration(eta.seconds)} away`
                  : copy.banner}
              </Text>
            </View>
          </View>

          {!driverCancelled && (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar initials={initialsFrom(driverName)} size={52} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>{driverName}</Text>
                </View>
              </View>
              <Hint>{vehicleLine}</Hint>
              {driverTags.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {driverTags.map((tag) => (
                    <Chip key={tag} label={tag} />
                  ))}
                </View>
              )}
              {/* Messaging rather than a phone button: no number is exchanged
                  either way, and several of this app's riders can't use a
                  call at all (0022). */}
              <SecondaryButton
                label={`Message ${driverFirstName}`}
                onPress={() => router.push({ pathname: '/chat', params: { rideId, title: driverFirstName } })}
              />
            </Card>
          )}

          {!riding && !driverCancelled && (
            <Card style={{ alignItems: 'center' }}>
              <Text style={type.sectionLabel} accessibilityRole="header">
                Share this PIN at pickup
              </Text>
              {/* Four separate boxes are four unlabelled elements to a screen
                  reader. Announce the whole thing once, digit by digit —
                  "5 6 4 3", not "five thousand six hundred and forty-three" —
                  and hide the individual boxes. A rider who can't read the
                  screen still has to be able to say this number out loud. */}
              <View
                style={{ flexDirection: 'row', gap: 10 }}
                accessible
                accessibilityRole="text"
                accessibilityLabel={
                  pin ? `Your pickup PIN is ${pin.split('').join(' ')}. Read it to your driver.` : 'Your pickup PIN is loading.'
                }
              >
                {pinDigits.map((digit, i) => (
                  <View
                    key={i}
                    style={{
                      width: 44,
                      height: 52,
                      borderRadius: 12,
                      backgroundColor: colors.surfaceAlt,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{digit}</Text>
                  </View>
                ))}
              </View>
              <Hint>{DriverFirstName} will confirm this before starting the ride.</Hint>
              {/* The way out of the five-wrong-attempts lockout (0028). Kept
                  quiet but always present: a driver mistyping at the kerb is
                  the moment this is needed, and "contact support" used to be
                  the only answer — for support that doesn't exist. */}
              {pinError && (
                <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={{ fontSize: 13, color: colors.alertDark }}>
                  {pinError}
                </Text>
              )}
              <Text
                onPress={handleNewPin}
                accessibilityRole="button"
                accessibilityLabel="Get a new PIN"
                accessibilityHint="Use this if your driver has typed the PIN wrong too many times"
                style={{ padding: 6, fontSize: 13, fontWeight: '700', color: colors.textSecondary }}
              >
                {reissuing ? 'Getting a new PIN…' : 'Driver having trouble? Get a new PIN'}
              </Text>
            </Card>
          )}

          {!driverCancelled && (
            <Card>
              <Hint>
                We shared {riderFirstName}'s description with {driverFirstName} so they can recognize {riderFirstName} at
                pickup.
              </Hint>
            </Card>
          )}

          <Text
            onPress={() => router.push({ pathname: '/(rider)/tracking', params: { rideId } })}
            style={{ alignSelf: 'center', padding: 6, fontSize: 13, fontWeight: '700', color: colors.textSecondary }}
          >
            View ride timeline
          </Text>
        </ScrollView>

        {!riding && !driverCancelled && (
          <View style={{ padding: spacing.lg, gap: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
            {error && <Hint>{error}</Hint>}
            {confirmingCancel ? (
              <>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, textAlign: 'center' }}>
                  {quotedFeeCents > 0
                    ? `Cancel and pay ${formatFee(quotedFeeCents)}?`
                    : `Cancel and pay up to ${formatFee(LATE_CANCEL_FEE_CENTS)}?`}
                </Text>
                {/* Only claim the window has passed when the server says so.
                    Without a quote we don't know, and saying so beats
                    inventing a certainty this screen doesn't have. */}
                <Hint>
                  {quotedFeeCents > 0
                    ? `${DriverFirstName} is already on the way, so the free window has passed. This is the exact amount.`
                    : `We couldn't check how long ${driverFirstName} has been on the way. If the free window has passed, this charges the standard fee — you'll see the exact amount straight after.`}
                </Hint>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <SecondaryButton label="Keep my ride" onPress={() => setConfirmingCancel(false)} />
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label={cancelling ? 'Cancelling…' : 'Cancel anyway'} onPress={handleCancel} disabled={cancelling} />
                  </View>
                </View>
              </>
            ) : (
              <View style={{ alignItems: 'center', gap: 8 }}>
                <SecondaryButton label={cancelling ? 'Cancelling…' : 'Cancel Ride'} onPress={handleCancel} />
                <Text style={{ fontSize: 12, color: colors.textTertiary, textAlign: 'center' }}>
                  {quotedFeeCents > 0
                    ? `Cancelling now costs ${formatFee(quotedFeeCents)}`
                    : graceMinutesLeft === null
                      ? quote
                        ? 'Free to cancel'
                        : `Cancelling may cost ${formatFee(LATE_CANCEL_FEE_CENTS)} — we'll confirm before charging`
                      : graceMinutesLeft > 0
                        ? `Free to cancel for the next ${graceMinutesLeft} min`
                        : `Cancelling now costs ${formatFee(LATE_CANCEL_FEE_CENTS)}`}
                </Text>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    </Screen>
  );
}
