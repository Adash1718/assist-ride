import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Card, Hint, PrimaryButton, Screen, SecondaryButton, SectionLabel, TopBar } from '../../components/ui';
import { AlertCircleIcon, CalendarIcon, CarIcon, CheckIcon, ClockIcon } from '../../components/Icon';
import { DatePickerModal } from '../../components/DatePickerModal';
import { TimePickerModal } from '../../components/TimePickerModal';
import { useProfiles } from '../../contexts/ProfileContext';
import { backOr } from '../../lib/nav';
import { formatDateLong, parseTimeLabel } from '../../lib/dateTime';
import {
  ACTIVE_RIDE_STATUSES,
  cancelRideRequest,
  countEligibleDriversForRide,
  rescheduleRideRequest,
  RideRequestData,
} from '../../lib/rideApi';
import { useLiveRide } from '../../lib/useLiveRide';

// How long before the rider is told it's taking a while. Eligible drivers
// exist in that case — they just haven't accepted — so nothing is cancelled
// or changed: the rider gets information and a choice (SPEC.md §4).
const STILL_LOOKING_AFTER_MS = 2 * 60 * 1000;
const TICK_MS = 15000;

// Why nobody can take this ride, in the rider's own terms, derived from the
// needs it was booked with (SPEC.md §3.C2 lists which needs are hard
// requirements — those are the ones that can leave a ride with no driver).
function unmetNeedPhrases(ride: RideRequestData): string[] {
  const s = ride.needsSnapshot ?? ({} as RideRequestData['needsSnapshot']);
  const aid = s.mobilityAid ?? 'None';
  const assist = s.assistanceNeeds ?? [];
  const comms = s.communicationNeeds ?? [];
  const phrases: string[] = [];
  if (aid === 'Power wheelchair') phrases.push('carry a power wheelchair');
  else if (aid.toLowerCase().includes('wheelchair'))
    phrases.push(s.foldable === 'No' ? 'carry a non-folding wheelchair' : 'carry a folding wheelchair');
  if (assist.includes('Help transferring to seat')) phrases.push('help with a transfer into the seat');
  if (assist.includes('Extra patience needed') || comms.includes('Prefers simple instructions'))
    phrases.push('support a rider who needs extra patience');
  if (ride.companionCount > 0) phrases.push(`seat ${ride.companionCount} companion${ride.companionCount > 1 ? 's' : ''}`);
  return phrases;
}

export default function Matching() {
  const { rider } = useProfiles();
  const { rideId, notice } = useLocalSearchParams<{ rideId: string; notice?: string }>();
  const { ride } = useLiveRide(rideId);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eligible, setEligible] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState<Date | null>(null);
  const [rescheduledFor, setRescheduledFor] = useState<string | null>(null);
  const leaving = useRef(false);
  const askedAtThreshold = useRef(false);
  const riderFirstName = rider.fullName.trim().split(' ')[0] || 'this rider';
  const afterDriverCancel = notice === 'driver_cancelled';

  const recheck = useCallback(async () => {
    if (!rideId) return;
    setChecking(true);
    const { count } = await countEligibleDriversForRide(rideId);
    setChecking(false);
    if (count !== null) setEligible(count);
  }, [rideId]);

  // When matching opens, and on an explicit refresh — not on a timer, so this
  // doesn't poll the database while a rider sits on the screen.
  useEffect(() => {
    recheck();
  }, [recheck]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // Real matching: wait for a driver to accept this exact ride row (only
  // drivers who can serve the rider's needs see it at all — driver_can_serve,
  // 0010). No polling — Realtime pushes the update, and useLiveRide's fetch
  // covers a driver who accepted before the subscription was live. This is
  // also where a ride lands after its driver hands it back before pickup: it's
  // simply back in the search.
  const status = ride?.status;
  useEffect(() => {
    if (leaving.current || !status) return;
    if (ACTIVE_RIDE_STATUSES.includes(status)) {
      leaving.current = true;
      router.replace({ pathname: '/(rider)/en-route', params: { rideId } });
    } else if (status === 'completed') {
      leaving.current = true;
      router.replace({ pathname: '/(rider)/complete', params: { rideId } });
    } else if (status === 'cancelled' || status === 'no_show') {
      leaving.current = true;
      router.replace({ pathname: '/(rider)/home', params: { notice: 'cancelled' } });
    }
  }, [status]);

  const elapsedMs = ride ? Math.max(0, now - new Date(ride.createdAt).getTime()) : 0;
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const pastThreshold = elapsedMs >= STILL_LOOKING_AFTER_MS;

  // One extra check the moment it starts taking a while, so "still looking"
  // isn't shown on a count from two minutes ago.
  useEffect(() => {
    if (pastThreshold && !askedAtThreshold.current) {
      askedAtThreshold.current = true;
      recheck();
    }
  }, [pastThreshold, recheck]);

  const phase: 'searching' | 'stillLooking' | 'noDrivers' =
    eligible === 0 ? 'noDrivers' : pastThreshold ? 'stillLooking' : 'searching';

  async function handleCancel() {
    if (!rideId) return;
    leaving.current = true; // our own cancel's Realtime echo mustn't navigate a second time
    setCancelling(true);
    setError(null);
    const { error: err } = await cancelRideRequest(rideId);
    setCancelling(false);
    if (err) {
      leaving.current = false;
      setError(err);
      return;
    }
    router.replace({ pathname: '/(rider)/home', params: { notice: 'cancelled' } });
  }

  async function handleReschedule(timeLabel: string) {
    if (!rideId || !pickedDate) return;
    const { hour, minute } = parseTimeLabel(timeLabel);
    const when = new Date(pickedDate.getFullYear(), pickedDate.getMonth(), pickedDate.getDate(), hour, minute);
    setError(null);
    const { error: err } = await rescheduleRideRequest(rideId, when.toISOString());
    if (err) {
      setError(err);
      return;
    }
    setRescheduledFor(`${formatDateLong(when)} at ${timeLabel}`);
  }

  const phrases = ride ? unmetNeedPhrases(ride) : [];
  const reason =
    phrases.length > 0
      ? `No available driver can ${phrases.join(' and ')} right now.`
      : 'No drivers are available right now.';

  const title = afterDriverCancel
    ? 'Finding a New Driver'
    : phase === 'noDrivers'
      ? 'No Drivers Available'
      : phase === 'stillLooking'
        ? 'Still Looking'
        : 'Finding a Driver';

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title={title} onBack={() => backOr('/(rider)/home')} />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {afterDriverCancel && (
            <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.accentDark }}>Your driver had to cancel</Text>
              <Hint>Your ride is still booked — you don't need to rebook. We're matching you with a new driver now.</Hint>
            </Card>
          )}

          {rescheduledFor && (
            <Card style={{ backgroundColor: colors.positiveSoft, borderColor: colors.positive }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <CalendarIcon size={16} color={colors.positiveDark} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.positiveDark }}>Scheduled for {rescheduledFor}</Text>
              </View>
              <Hint>We're still looking now as well — this ride stays open to drivers rather than waiting until then.</Hint>
            </Card>
          )}

          <View style={{ alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.lg }}>
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: phase === 'noDrivers' ? colors.alertSoft : colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {phase === 'noDrivers' ? (
                <AlertCircleIcon size={32} color={colors.alertDark} />
              ) : phase === 'stillLooking' ? (
                <ClockIcon size={30} color={colors.accentDark} />
              ) : (
                <CarIcon size={32} color={colors.accentDark} />
              )}
            </View>

            <View style={{ alignItems: 'center', gap: 8 }}>
              {phase === 'noDrivers' ? (
                <>
                  <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>No drivers available right now</Text>
                  <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
                    {reason} Nobody is on the way yet — you can wait for one to come online, book for a later time, or cancel.
                  </Text>
                </>
              ) : phase === 'stillLooking' ? (
                <>
                  <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>
                    Still looking{elapsedMin > 0 ? ` — ${elapsedMin} min so far` : ''}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
                    {eligible === 1 ? 'A driver who can help' : 'Drivers who can help'} {riderFirstName} {eligible === 1 ? 'is' : 'are'}{' '}
                    online, but {eligible === 1 ? 'they haven' : 'none has'}'t accepted yet. We'll keep waiting unless you'd rather
                    change something.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>
                    Looking for a driver{'\n'}who can help {riderFirstName}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
                    This may take a little longer than a standard ride — we're matching a specially qualified driver.
                  </Text>
                </>
              )}
            </View>

            <Card style={{ width: '100%' }}>
              <MatchRow label="Ride request sent" done />
              <MatchRow
                label={phase === 'noDrivers' ? 'Waiting for a driver who can help to come online' : 'Waiting for a driver to accept…'}
                done={false}
              />
            </Card>

            {phase === 'searching' && <Hint>You'll move to the next screen the moment a driver accepts.</Hint>}
          </View>

          {phase !== 'searching' && (
            <Card>
              <SectionLabel>Your options</SectionLabel>
              {error && <Hint>{error}</Hint>}
              <PrimaryButton
                label={checking ? 'Checking…' : 'Keep waiting'}
                onPress={recheck}
                disabled={checking}
              />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <SecondaryButton label="Book for later" onPress={() => setDatePickerOpen(true)} />
                <SecondaryButton label={cancelling ? 'Cancelling…' : 'Cancel request'} onPress={handleCancel} />
              </View>
              <Hint>Waiting changes nothing — your request stays exactly as it is.</Hint>
            </Card>
          )}
        </ScrollView>

        {phase === 'searching' && (
          <View style={{ padding: spacing.lg, gap: 8 }}>
            {error && <Hint>{error}</Hint>}
            <SecondaryButton label={cancelling ? 'Cancelling…' : 'Cancel Request'} onPress={handleCancel} />
          </View>
        )}

        <DatePickerModal
          visible={datePickerOpen}
          initialDate={pickedDate}
          onClose={() => setDatePickerOpen(false)}
          onSelect={(date) => {
            setPickedDate(date);
            setDatePickerOpen(false);
            setTimePickerOpen(true);
          }}
        />
        <TimePickerModal
          visible={timePickerOpen}
          forDate={pickedDate}
          onClose={() => setTimePickerOpen(false)}
          onSelect={(label) => {
            setTimePickerOpen(false);
            handleReschedule(label);
          }}
        />
      </SafeAreaView>
    </Screen>
  );
}

function MatchRow({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? colors.positiveSoft : colors.surfaceAlt,
        }}
      >
        {done ? <CheckIcon size={14} color={colors.positiveDark} /> : <ClockIcon size={13} color={colors.textTertiary} />}
      </View>
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: done ? colors.text : colors.textSecondary }}>{label}</Text>
    </View>
  );
}
