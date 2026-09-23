import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { backOr } from '../../lib/nav';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import {
  Avatar,
  Card,
  Chip,
  Divider,
  Hint,
  PrimaryButton,
  SectionLabel,
  SegmentedControl,
  Screen,
  Stepper,
  TopBar,
} from '../../components/ui';
import { CalendarIcon, ClockIcon, MapPinIcon } from '../../components/Icon';
import { RiderProfileData, useProfiles } from '../../contexts/ProfileContext';
import { useAuth } from '../../contexts/AuthContext';
import { fetchRiderProfile } from '../../lib/profileApi';
import { initialsFrom } from '../../lib/format';
import { formatDateLong, parseTimeLabel } from '../../lib/dateTime';
import { DatePickerModal } from '../../components/DatePickerModal';
import { TimePickerModal } from '../../components/TimePickerModal';
import { buildNeedsSnapshot, createRideRequest } from '../../lib/rideApi';

export default function BookRide() {
  const { rider } = useProfiles();
  const { user } = useAuth();
  // Booking for someone else (0017): a proxy arrives here with the rider's
  // id. Their profile is read from the database — ProfileContext only ever
  // holds the signed-in person's own details.
  const { forRiderId } = useLocalSearchParams<{ forRiderId?: string }>();
  const [forRider, setForRider] = useState<RiderProfileData | null>(null);
  const [selfProfile, setSelfProfile] = useState<RiderProfileData | null>(null);
  const [rideMode, setRideMode] = useState('Now');
  // Empty on purpose: these used to be prefilled with demo addresses, which
  // a rider could submit without noticing they'd booked a ride to a place
  // they never chose.
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [scheduledTime, setScheduledTime] = useState('');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  // Nobody riding along unless the requester says so — and since 0010 matches
  // on the driver's companion_seats, a stray default would filter out drivers
  // for a companion who doesn't exist.
  const [companions, setCompanions] = useState(0);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!forRiderId) return;
    (async () => {
      const { data } = await fetchRiderProfile(forRiderId);
      setForRider(data);
    })();
  }, [forRiderId]);

  // ProfileContext is in-memory: reaching this screen directly (a refresh, a
  // deep link, one of the app's own redirects) leaves it empty, and booking
  // from that state would attach an EMPTY needs snapshot to the ride — every
  // driver would then be matched as if the rider had no needs at all.
  useEffect(() => {
    if (forRiderId || !user || rider.fullName.trim() !== '') return;
    (async () => {
      const { data } = await fetchRiderProfile(user.id);
      if (data) setSelfProfile(data);
    })();
  }, [forRiderId, user, rider.fullName]);

  // Whose ride this is: the signed-in rider, or the person they act for.
  const subject = forRider ?? (rider.fullName.trim() !== '' ? rider : selfProfile ?? rider);
  const bookingForSomeoneElse = !!forRiderId;
  const riderName = subject.fullName.trim() || 'this rider';
  const needChips = [subject.mobilityAid !== 'None' ? subject.mobilityAid : null, ...subject.communicationNeeds, ...subject.assistanceNeeds]
    .filter((c): c is string => !!c)
    .slice(0, 3);

  // Don't let a proxy submit before the rider's needs have loaded — the
  // snapshot on the ride is what every driver is matched against.
  const canSubmit =
    subject.fullName.trim() !== '' && // never book with an empty needs snapshot
    pickup.trim() !== '' &&
    dropoff.trim() !== '' &&
    (rideMode === 'Now' || (scheduledDate !== null && scheduledTime !== '')) &&
    (!bookingForSomeoneElse || forRider !== null);

  async function handleSubmit() {
    if (!user) return;
    setSubmitting(true);
    setSubmitError(null);

    let requestedTime = new Date();
    if (rideMode === 'Schedule' && scheduledDate) {
      const { hour, minute } = parseTimeLabel(scheduledTime);
      requestedTime = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), scheduledDate.getDate(), hour, minute);
    }

    const { data, error } = await createRideRequest({
      requestedBy: user.id,
      riderId: forRiderId ?? user.id,
      companionCount: companions,
      pickup,
      dropoff,
      rideMode: rideMode === 'Now' ? 'on_demand' : 'scheduled',
      requestedTime: requestedTime.toISOString(),
      rideNotes: notes,
      needsSnapshot: buildNeedsSnapshot(subject),
    });

    setSubmitting(false);
    if (error || !data) {
      setSubmitError(error ?? 'Something went wrong creating the request.');
      return;
    }
    router.push({ pathname: '/(rider)/matching', params: { rideId: data.id } });
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title="Book a Ride" onBack={() => backOr('/(rider)/home')} right={<Avatar initials={initialsFrom(subject.fullName)} size={40} />} />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Card>
            <SectionLabel>Booking for</SectionLabel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar initials={initialsFrom(subject.fullName)} size={48} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>
                  {subject.fullName || (bookingForSomeoneElse ? 'Loading their details…' : 'No profile yet')}
                </Text>
                {bookingForSomeoneElse && <Hint>You're booking as their helper — they'll see this ride in their app too.</Hint>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {needChips.length > 0 ? (
                    needChips.map((c) => <Chip key={c} label={c} />)
                  ) : (
                    <Hint>No needs on file yet — edit the profile to add them.</Hint>
                  )}
                </View>
              </View>
            </View>
            {/* This used to be a dead label. Now that proxy links exist
                (0017) it does what it always implied. */}
            <Text
              onPress={() =>
                bookingForSomeoneElse ? router.replace('/(rider)/book') : router.push('/(rider)/people')
              }
              style={{ color: colors.accentDark, fontWeight: '700', fontSize: 14 }}
            >
              {bookingForSomeoneElse ? 'Book for myself instead' : 'Book for someone else'}
            </Text>
          </Card>

          <SegmentedControl options={['Now', 'Schedule']} value={rideMode} onChange={setRideMode} />

          {rideMode === 'Schedule' && (
            <Card>
              <SectionLabel>When</SectionLabel>
              <Text style={type.label}>Date</Text>
              <Pressable
                onPress={() => setDatePickerOpen(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <CalendarIcon size={18} color={colors.textTertiary} />
                <Text style={{ fontSize: 16, flex: 1, color: scheduledDate ? colors.text : colors.textTertiary }}>
                  {scheduledDate ? formatDateLong(scheduledDate) : 'Choose a date'}
                </Text>
              </Pressable>
              <Text style={type.label}>Time</Text>
              <Pressable
                onPress={() => scheduledDate && setTimePickerOpen(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  padding: 14,
                  opacity: scheduledDate ? 1 : 0.5,
                }}
              >
                <ClockIcon size={18} color={colors.textTertiary} />
                <Text style={{ fontSize: 16, flex: 1, color: scheduledTime ? colors.text : colors.textTertiary }}>
                  {scheduledTime || (scheduledDate ? 'Choose a time' : 'Pick a date first')}
                </Text>
              </Pressable>
              <Hint>We start looking for a driver about an hour before the pickup time.</Hint>
            </Card>
          )}

          <DatePickerModal
            visible={datePickerOpen}
            initialDate={scheduledDate}
            onClose={() => setDatePickerOpen(false)}
            onSelect={(d) => {
              setScheduledDate(d);
              setScheduledTime(''); // previous time may no longer be valid for the new date
              setDatePickerOpen(false);
            }}
          />
          <TimePickerModal
            visible={timePickerOpen}
            forDate={scheduledDate}
            onClose={() => setTimePickerOpen(false)}
            onSelect={(label) => {
              setScheduledTime(label);
              setTimePickerOpen(false);
            }}
          />

          <Card>
            <Text style={type.label}>Pickup</Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 14,
              }}
            >
              <MapPinIcon size={18} color={colors.textTertiary} />
              <TextInput value={pickup} onChangeText={setPickup} style={{ fontSize: 16, flex: 1, color: colors.text }} />
            </View>
            <Text style={type.label}>Dropoff</Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 14,
              }}
            >
              <MapPinIcon size={18} color={colors.textTertiary} />
              <TextInput value={dropoff} onChangeText={setDropoff} style={{ fontSize: 16, flex: 1, color: colors.text }} />
            </View>
          </Card>

          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={type.label}>Riding along with {riderName}?</Text>
                <Hint>Companions, not requiring assistance</Hint>
              </View>
              <Stepper value={companions} onChange={setCompanions} />
            </View>
          </Card>

          <Card>
            <Text style={type.label}>Anything specific for this trip? (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. bringing a folding walker today"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 14,
                fontSize: 16,
                minHeight: 56,
                color: colors.text,
              }}
            />
          </Card>

          {rideMode === 'Now' && (
            <Card>
              {/* There used to be an "Estimated wait ~9 min" line here. There
                  is no ETA anywhere in this app — no geo, no routing — so it
                  was a number made up at build time. How long matching takes
                  depends on who's online, which the matching screen reports
                  honestly once the ride exists. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ClockIcon size={16} color={colors.textTertiary} />
                <Hint>Specialized drivers may take a little longer than a standard ride — we'll tell you how it's going.</Hint>
              </View>
              <Divider />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Hint>Fare (flat placeholder)</Hint>
                <Text style={{ fontWeight: '700', fontSize: 14, color: colors.text }}>$19.50</Text>
              </View>
              <Hint>Pricing isn't worked out yet (SPEC §4) and nothing is charged.</Hint>
            </Card>
          )}
        </ScrollView>

        <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, gap: 8 }}>
          {submitError && <Text style={{ fontSize: 13, color: colors.alertDark }}>{submitError}</Text>}
          <PrimaryButton
            label={submitting ? 'Requesting…' : rideMode === 'Now' ? 'Find a Driver' : 'Schedule Ride'}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
          />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
