import { useState } from 'react';
import { router } from 'expo-router';
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
import { useProfiles } from '../../contexts/ProfileContext';
import { useAuth } from '../../contexts/AuthContext';
import { initialsFrom } from '../../lib/format';
import { formatDateLong, parseTimeLabel } from '../../lib/dateTime';
import { DatePickerModal } from '../../components/DatePickerModal';
import { TimePickerModal } from '../../components/TimePickerModal';
import { buildNeedsSnapshot, createRideRequest } from '../../lib/rideApi';

export default function BookRide() {
  const { rider } = useProfiles();
  const { user } = useAuth();
  const [rideMode, setRideMode] = useState('Now');
  const [pickup, setPickup] = useState('123 Maple Street');
  const [dropoff, setDropoff] = useState('Riverside Medical Center');
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

  const riderName = rider.fullName.trim() || 'this rider';
  const needChips = [rider.mobilityAid !== 'None' ? rider.mobilityAid : null, ...rider.communicationNeeds, ...rider.assistanceNeeds]
    .filter((c): c is string => !!c)
    .slice(0, 3);

  const canSubmit = rideMode === 'Now' || (scheduledDate !== null && scheduledTime !== '');

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
      riderId: user.id,
      companionCount: companions,
      pickup,
      dropoff,
      rideMode: rideMode === 'Now' ? 'on_demand' : 'scheduled',
      requestedTime: requestedTime.toISOString(),
      rideNotes: notes,
      needsSnapshot: buildNeedsSnapshot(rider),
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
        <TopBar title="Book a Ride" onBack={() => backOr('/(rider)/home')} right={<Avatar initials={initialsFrom(rider.fullName)} size={40} />} />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Card>
            <SectionLabel>Booking for</SectionLabel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar initials={initialsFrom(rider.fullName)} size={48} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>{rider.fullName || 'No profile yet'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {needChips.length > 0 ? (
                    needChips.map((c) => <Chip key={c} label={c} />)
                  ) : (
                    <Hint>No needs on file yet — edit the profile to add them.</Hint>
                  )}
                </View>
              </View>
            </View>
            <Text style={{ color: colors.accentDark, fontWeight: '700', fontSize: 14 }}>Switch profile</Text>
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
              <Hint>Scheduled rides get priority matching ahead of the pickup time.</Hint>
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
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ClockIcon size={16} color={colors.textTertiary} />
                  <Hint>Estimated wait</Hint>
                </View>
                <Text style={{ fontWeight: '700', fontSize: 14, color: colors.text }}>~9 min</Text>
              </View>
              <Hint>Specialized drivers may take a little longer than a standard ride.</Hint>
              <Divider />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Hint>Estimated fare</Hint>
                <Text style={{ fontWeight: '700', fontSize: 14, color: colors.text }}>$18–22</Text>
              </View>
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
