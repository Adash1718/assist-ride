import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Card, Hint, IconButton, PrimaryButton, Screen, SecondaryButton, SectionLabel } from '../../components/ui';
import { CheckIcon, ChevronLeftIcon, ClockIcon } from '../../components/Icon';
import { RecognizeRiderCard, RiderNeedsCard, TripCard } from '../../components/RideCards';
import {
  advanceRideStatus,
  driverCancelRide,
  EmergencyContactForDriver,
  fetchRideEmergencyContacts,
  fetchRideEvents,
  formatFee,
  markNoShow,
  NO_SHOW_FEE_CENTS,
  NO_SHOW_WAIT_MINUTES,
  PRE_PICKUP_STATUSES,
  RideRequestData,
  RideStatus,
  startRideWithPin,
} from '../../lib/rideApi';
import { useLiveRide } from '../../lib/useLiveRide';

// The driver's side of a matched ride (SPEC.md §3.D–G): drive to pickup →
// arrive → confirm the rider's PIN → ride → complete. Driver Home sends a
// driver here whenever they have an active ride and offers them no new
// requests until it ends, so this is where every matched driver lands.
// Before pickup the driver can also hand the ride back (driverCancelRide) —
// it goes back into the search for another driver rather than ending — and
// at pickup, after a real wait, mark a no-show (0016).

type Step = { status: RideStatus; label: string; action: string; next: RideStatus };

const STEPS: Step[] = [
  { status: 'matched', label: 'Ride accepted', action: 'Start driving to pickup', next: 'driver_en_route' },
  { status: 'driver_en_route', label: 'Driving to pickup', action: "I've arrived at pickup", next: 'arrived' },
  { status: 'arrived', label: 'At pickup — confirm PIN', action: 'Confirm PIN & start ride', next: 'in_progress' },
  { status: 'in_progress', label: 'Ride in progress', action: 'Complete ride', next: 'completed' },
];

const TICK_MS = 15000;

function backToDriverHome() {
  router.dismissTo('/(driver)/driver-home');
}

export default function ActiveRide() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { ride, loading, setRide } = useLiveRide(rideId);
  const [pinEntry, setPinEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingNoShow, setConfirmingNoShow] = useState(false);
  const [arrivedAt, setArrivedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Not visible to this driver (any more) — nothing to show here.
  useEffect(() => {
    if (!loading && !ride) backToDriverHome();
  }, [loading, ride]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // The rider cancelled (pushed live — the row stays visible to the matched
  // driver, so Realtime delivers it).
  const cancelled = ride?.status === 'cancelled';
  useEffect(() => {
    if (!cancelled) return;
    const t = setTimeout(backToDriverHome, 2500);
    return () => clearTimeout(t);
  }, [cancelled]);

  // When this driver actually arrived, from the ride's event log (0009) —
  // the database uses the same timestamp to decide whether a no-show may be
  // marked yet (0016); this is so the screen can show the wait counting down.
  const status = ride?.status;
  useEffect(() => {
    if (!rideId || status !== 'arrived') return;
    (async () => {
      const { data } = await fetchRideEvents(rideId);
      const arrived = [...data].reverse().find((e) => e.status === 'arrived');
      if (arrived) setArrivedAt(new Date(arrived.at).getTime());
    })();
  }, [rideId, status]);

  const currentIndex = STEPS.findIndex((s) => s.status === ride?.status);
  const step = currentIndex >= 0 ? STEPS[currentIndex] : null;
  const canHandBack = !!ride && PRE_PICKUP_STATUSES.includes(ride.status);
  const noShowAllowedAt = arrivedAt === null ? null : arrivedAt + NO_SHOW_WAIT_MINUTES * 60000;
  const noShowMinutesLeft = noShowAllowedAt === null ? null : Math.max(0, Math.ceil((noShowAllowedAt - now) / 60000));
  const canMarkNoShow = status === 'arrived' && noShowMinutesLeft === 0;

  async function advance() {
    if (!ride || !step) return;
    setError(null);
    // Starting the ride is the one step this screen can't do itself: the pin
    // is checked in the database and the status change happens there (0018),
    // so a wrong pin can't be stepped past. This app never sees the pin.
    if (step.status === 'arrived') {
      setBusy(true);
      const { error: err } = await startRideWithPin(ride.id, pinEntry);
      setBusy(false);
      if (err) {
        setError(err);
        return;
      }
      setPinEntry('');
      setRide((prev) => (prev && prev.status === 'arrived' ? { ...prev, status: 'in_progress' } : prev));
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
    // Show our own update right away rather than waiting for its Realtime
    // echo — unless a newer live change (e.g. the rider cancelling) already
    // landed, which must not be overwritten.
    setRide((prev) => (prev?.status === step.status ? data : prev));
  }

  async function handBack() {
    if (!ride) return;
    setBusy(true);
    setError(null);
    const { error: err } = await driverCancelRide(ride.id);
    setBusy(false);
    if (err) {
      setConfirmingCancel(false);
      setError(err);
      return;
    }
    backToDriverHome();
  }

  async function handleNoShow() {
    if (!ride) return;
    setBusy(true);
    setError(null);
    const { error: err } = await markNoShow(ride.id);
    setBusy(false);
    if (err) {
      setConfirmingNoShow(false);
      setError(err);
      return;
    }
    backToDriverHome();
  }

  if (loading || !ride) return null;

  const pillLabel = cancelled ? 'Cancelled' : step?.label ?? '';
  // The name the ride was booked under (the snapshot, not a profile read —
  // drivers can't read rider profiles).
  const riderFirstName = (ride.needsSnapshot?.riderName ?? '').trim().split(' ')[0] || 'your rider';

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
          {/* Without this the screen is a dead end: Driver Home is the only
              route to sign-out and the profile, and its focus effect sends an
              on-ride driver straight back here — so handing the ride back was
              the only way off. The ride keeps running. */}
          <IconButton label="Back to driver home — your ride keeps going" onPress={() => router.replace({ pathname: '/(driver)/driver-home', params: { stay: '1' } })}>
            <ChevronLeftIcon size={16} />
          </IconButton>
          <Text style={{ flex: 1, fontSize: 19, fontWeight: '700', color: colors.text, marginLeft: spacing.md }}>Active Ride</Text>
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
          {!cancelled && (
            <Card>
              {/* No phone number in either direction (0022) — and the rider
                  may be someone who can't take a call, which is half the
                  reason they booked this service. */}
              <SectionLabel>Need to reach them?</SectionLabel>
              <Hint>Messages go straight to {riderFirstName} — and to the person who booked, if a caregiver arranged it.</Hint>
              <SecondaryButton
                label={`Message ${riderFirstName}`}
                onPress={() => router.push({ pathname: '/chat', params: { rideId: ride.id, title: riderFirstName } })}
              />
            </Card>
          )}
          {!cancelled && <EmergencyContactsCard ride={ride} />}
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
            {/* Announced, not just displayed: a driver who mistypes the PIN
                needs to hear "3 tries left", not wonder why nothing happened. */}
            {error && (
              <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={{ fontSize: 13, color: colors.alertDark }}>
                {error}
              </Text>
            )}

            {confirmingCancel ? (
              <>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Cancel this ride?</Text>
                <Hint>The rider keeps their booking and we'll find them another driver. You won't be offered this ride again.</Hint>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <SecondaryButton label="Keep ride" onPress={() => setConfirmingCancel(false)} />
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label={busy ? 'Cancelling…' : 'Yes, cancel ride'} onPress={handBack} disabled={busy} />
                  </View>
                </View>
              </>
            ) : confirmingNoShow ? (
              <>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Mark this as a no-show?</Text>
                <Hint>
                  You've waited {NO_SHOW_WAIT_MINUTES} minutes at pickup. This ends the ride and charges the rider the{' '}
                  {formatFee(NO_SHOW_FEE_CENTS)} no-show fee — please check for them once more first.
                </Hint>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <SecondaryButton label="Keep waiting" onPress={() => setConfirmingNoShow(false)} />
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label={busy ? 'Ending…' : 'Yes, no-show'} onPress={handleNoShow} disabled={busy} />
                  </View>
                </View>
              </>
            ) : (
              <>
                {step.status === 'arrived' && (
                  <TextInput
                    value={pinEntry}
                    onChangeText={(t) => setPinEntry(t.replace(/\D/g, '').slice(0, 4))}
                    accessibilityLabel="Rider's 4-digit PIN"
                    accessibilityHint="Ask the rider to read out the PIN shown in their app"
                    placeholder="Rider's 4-digit PIN"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="number-pad"
                    maxLength={4}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.borderStrong,
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
                {step.status === 'arrived' && (
                  <Pressable
                    onPress={() => canMarkNoShow && setConfirmingNoShow(true)}
                    disabled={!canMarkNoShow}
                    style={{ alignSelf: 'center', padding: 6 }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: canMarkNoShow ? colors.alertDark : colors.textTertiary }}>
                      {canMarkNoShow
                        ? "Rider didn't show"
                        : noShowMinutesLeft === null
                          ? `Wait ${NO_SHOW_WAIT_MINUTES} min before reporting a no-show`
                          : `No-show can be reported in ${noShowMinutesLeft} min`}
                    </Text>
                  </Pressable>
                )}
                {canHandBack && (
                  <Pressable onPress={() => setConfirmingCancel(true)} style={{ alignSelf: 'center', padding: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary }}>Can't make it? Cancel ride</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}
      </SafeAreaView>
    </Screen>
  );
}

// Emergency contacts, available only between pickup and dropoff (0020).
// Deliberately kept behind a tap and not fetched on render: the database logs
// every read for the rider, so an automatic fetch would report a driver as
// having looked at a family member's number when they never did.
function EmergencyContactsCard({ ride }: { ride: RideRequestData }) {
  const [contacts, setContacts] = useState<EmergencyContactForDriver[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ride.status !== 'arrived' && ride.status !== 'in_progress') return null;

  async function reveal() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchRideEmergencyContacts(ride.id);
    setLoading(false);
    if (err) return setError(err);
    setContacts(data);
  }

  return (
    <Card>
      <SectionLabel>If something goes wrong</SectionLabel>
      {contacts === null ? (
        <>
          <Hint>
            For emergencies only — call 911 first if someone is in danger. The rider is told whenever these are opened.
          </Hint>
          {error && <Hint>{error}</Hint>}
          <SecondaryButton label={loading ? 'Opening…' : "Show rider's emergency contacts"} onPress={reveal} />
        </>
      ) : contacts.length === 0 ? (
        <Hint>This rider hasn't saved an emergency contact.</Hint>
      ) : (
        <>
          {contacts.map((c) => (
            <Pressable key={c.id} onPress={() => Linking.openURL(`tel:${c.phone.replace(/[^\d+]/g, '')}`)}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>
                {c.name}
                {/* Who they are to the rider (0025) — a driver ringing a
                    stranger needs to know whether they've got a daughter or
                    a support worker on the line. */}
                {c.relationship?.trim() ? (
                  <Text style={{ fontWeight: '600', color: colors.textSecondary }}> · {c.relationship}</Text>
                ) : null}
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.accent }}>{c.phone}</Text>
            </Pressable>
          ))}
          <Hint>Shared with you for this ride only. You'll lose access when the ride ends.</Hint>
        </>
      )}
    </Card>
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
