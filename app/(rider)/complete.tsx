import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Card, Divider, Hint, PrimaryButton, Screen, SectionLabel } from '../../components/ui';
import { CheckIcon, StarIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { useAuth } from '../../contexts/AuthContext';
import { fetchRideRequest, RideRequestData } from '../../lib/rideApi';
import { fetchRideFeedback, RideFeedback, submitRideFeedback } from '../../lib/feedbackApi';

function StarRow({
  value,
  onChange,
  size = 16,
  readOnly,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  readOnly?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) =>
        readOnly ? (
          <StarIcon key={n} size={size} filled={n <= value} color={n <= value ? colors.accent : colors.border} />
        ) : (
          <Pressable key={n} onPress={() => onChange?.(n)} hitSlop={4}>
            <StarIcon size={size} filled={n <= value} color={n <= value ? colors.accent : colors.border} />
          </Pressable>
        )
      )}
    </View>
  );
}

// Trip details are the real ride; the fare is still SPEC.md §4's v1 flat
// placeholder. Feedback is stored for real (SPEC.md §2.6, migration 0014):
// one submission per ride, immutable afterwards, so a ride that was already
// rated shows what was said rather than an empty form.
export default function RideComplete() {
  const { rider } = useProfiles();
  const { user } = useAuth();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [ride, setRide] = useState<RideRequestData | null>(null);
  const [existing, setExisting] = useState<RideFeedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const riderFirstName = rider.fullName.trim().split(' ')[0] || 'The rider';
  const [mobilityRating, setMobilityRating] = useState(4);
  const [patienceRating, setPatienceRating] = useState(5);
  const [vehicleRating, setVehicleRating] = useState(5);
  const [overall, setOverall] = useState(5);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    (async () => {
      const [{ data: rideData }, { data: feedbackData }] = await Promise.all([fetchRideRequest(rideId), fetchRideFeedback(rideId)]);
      if (cancelled) return;
      setRide(rideData);
      setExisting(feedbackData);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId]);

  async function handleSubmit() {
    if (!rideId || !user || !ride?.matchedDriverId) return;
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await submitRideFeedback({
      rideId,
      riderId: user.id,
      driverId: ride.matchedDriverId,
      mobilityRating,
      patienceRating,
      vehicleRating,
      overallRating: overall,
      comment,
    });
    setSubmitting(false);
    if (err || !data) {
      setError(err ?? 'Something went wrong. Please try again.');
      return;
    }
    setExisting(data);
  }

  if (loading) return null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, gap: spacing.md }}>
          <View style={{ alignItems: 'center', gap: 10, paddingBottom: 6 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: colors.positiveSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckIcon size={26} color={colors.positiveDark} />
            </View>
            <Text style={{ fontSize: 19, fontWeight: '700', color: colors.text }}>Ride Complete</Text>
            <Hint>
              {riderFirstName} arrived safely{ride?.dropoff ? ` at ${ride.dropoff}` : ''}
            </Hint>
          </View>

          <Card>
            <TripRow k="Pickup" v={ride?.pickup ?? '—'} />
            <TripRow k="Dropoff" v={ride?.dropoff ?? '—'} />
            <Divider />
            <TripRow k="Fare" v="$19.50" />
          </Card>

          {existing ? (
            <Card>
              <SectionLabel>Your feedback</SectionLabel>
              <Hint>Thanks — this is what you sent the team about this ride.</Hint>

              <RateRow label={`Helped with ${riderFirstName}'s mobility aid`} value={existing.mobilityRating} readOnly />
              <RateRow label="Was patient and communicated clearly" value={existing.patienceRating} readOnly />
              <RateRow label="Vehicle fit our needs" value={existing.vehicleRating} readOnly />

              <Divider />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Overall rating</Text>
                <StarRow value={existing.overallRating} size={22} readOnly />
              </View>

              {existing.comment.trim() !== '' && <Hint>"{existing.comment}"</Hint>}
            </Card>
          ) : (
            <Card>
              <SectionLabel>How was the assistance?</SectionLabel>

              <RateRow label={`Helped with ${riderFirstName}'s mobility aid`} value={mobilityRating} onChange={setMobilityRating} />
              <RateRow label="Was patient and communicated clearly" value={patienceRating} onChange={setPatienceRating} />
              <RateRow label="Vehicle fit our needs" value={vehicleRating} onChange={setVehicleRating} />

              <Divider />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Overall rating</Text>
                <StarRow value={overall} onChange={setOverall} size={22} />
              </View>

              <Pressable onPress={() => router.push({ pathname: '/(rider)/tracking', params: { rideId } })} style={{ alignSelf: 'flex-start' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary }}>View ride timeline</Text>
              </Pressable>

              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Anything else you'd like to share? (optional)"
                placeholderTextColor={colors.textTertiary}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  padding: 14,
                  fontSize: 15,
                  minHeight: 56,
                  color: colors.text,
                }}
              />
              <Hint>Feedback is sent once and can't be edited afterwards.</Hint>
            </Card>
          )}

          {existing && (
            <Pressable onPress={() => router.push({ pathname: '/(rider)/tracking', params: { rideId } })} style={{ alignSelf: 'flex-start' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary }}>View ride timeline</Text>
            </Pressable>
          )}
        </ScrollView>

        <View
          style={{
            padding: spacing.lg,
            alignItems: 'center',
            gap: 10,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          {error && <Hint>{error}</Hint>}
          {existing ? (
            <PrimaryButton label="Done" onPress={() => router.replace('/(rider)/home')} />
          ) : (
            <>
              <PrimaryButton
                label={submitting ? 'Sending…' : 'Submit Feedback'}
                onPress={handleSubmit}
                disabled={submitting || !ride?.matchedDriverId}
              />
              <Pressable onPress={() => router.replace('/(rider)/home')}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary }}>Skip for now</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </Screen>
  );
}

function TripRow({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text style={{ fontSize: 14, color: colors.textSecondary }}>{k}</Text>
      <Text style={{ flexShrink: 1, textAlign: 'right', fontSize: 14, fontWeight: '700', color: colors.text }}>{v}</Text>
    </View>
  );
}

function RateRow({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, maxWidth: 180 }}>{label}</Text>
      <StarRow value={value} onChange={onChange} readOnly={readOnly} />
    </View>
  );
}
