import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Card, Chip, Divider, Hint, PrimaryButton, Screen, SecondaryButton, SectionLabel } from '../../components/ui';
import { CheckIcon, StarIcon } from '../../components/Icon';
import { EmergencyAccessNotice } from '../../components/RideCards';
import { useProfiles } from '../../contexts/ProfileContext';
import { useAuth } from '../../contexts/AuthContext';
import { fetchRideRequest, formatFee, RideRequestData } from '../../lib/rideApi';
import {
  correctRideFeedback,
  FEEDBACK_EDIT_WINDOW_HOURS,
  feedbackStillEditable,
  fetchRideFeedback,
  RideFeedback,
  submitRideFeedback,
} from '../../lib/feedbackApi';
import { formatDistance, formatDuration } from '../../lib/geoApi';
import { INCIDENT_CATEGORIES, IncidentCategory, reportIncident } from '../../lib/incidentApi';

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
  // Correcting something already sent (0031). Ratings can now stop a driver
  // being matched for a kind of ride, so a mistaken tap needs a way back.
  const [editing, setEditing] = useState(false);
  // Reporting something that went wrong (0032). Separate from the star
  // ratings on purpose: "rough handling" is not a number out of five, and a
  // rider shouldn't have to encode it as one.
  const [reporting, setReporting] = useState(false);
  const [reportCategory, setReportCategory] = useState<IncidentCategory | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  const [reported, setReported] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function handleReport() {
    if (!rideId || !user || !ride?.matchedDriverId || !ride?.riderId || !reportCategory) return;
    setSubmitting(true);
    setReportError(null);
    const { error: err } = await reportIncident({
      rideId,
      riderId: ride.riderId,
      driverId: ride.matchedDriverId,
      reportedBy: user.id,
      category: reportCategory,
      details: reportDetails,
    });
    setSubmitting(false);
    if (err) {
      setReportError(err);
      return;
    }
    setReported(true);
    setReporting(false);
  }

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

  function startEditing() {
    if (!existing) return;
    setMobilityRating(existing.mobilityRating);
    setPatienceRating(existing.patienceRating);
    setVehicleRating(existing.vehicleRating);
    setOverall(existing.overallRating);
    setComment(existing.comment);
    setError(null);
    setEditing(true);
  }

  async function handleCorrect() {
    if (!rideId) return;
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await correctRideFeedback({
      rideId,
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
    setEditing(false);
  }

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

          {rideId && <EmergencyAccessNotice rideId={rideId} />}

          {reported && (
            <Card style={{ backgroundColor: colors.positiveSoft, borderColor: colors.positive }}>
              <SectionLabel>Report sent</SectionLabel>
              {/* Says exactly what happens, and nothing more. There is no
                  support desk behind this — promising a review nobody will do
                  is the empty promise this app has had to remove elsewhere. */}
              <Hint>
                This driver won't be matched with you again. Your report is kept on record, and they're never told who
                reported them.
              </Hint>
            </Card>
          )}

          <Card>
            <TripRow k="Pickup" v={ride?.pickup ?? '—'} />
            <TripRow k="Dropoff" v={ride?.dropoff ?? '—'} />
            {/* Only shown when the addresses actually resolved (0023) — the
                fare below is still a placeholder, but this isn't. */}
            {ride?.routeMeters != null && ride?.routeSeconds != null && (
              <TripRow k="Trip" v={`${formatDistance(ride.routeMeters)} · ${formatDuration(ride.routeSeconds)}`} />
            )}
            <Divider />
            {/* The number this rider was quoted at booking (0026), read
                back from the ride rather than recomputed — so a later change
                to the rates can't rewrite what they were told. Still nothing
                bills anyone. */}
            {ride?.fareEstimateCents != null ? (
              <TripRow k="Estimated fare" v={formatFee(ride.fareEstimateCents)} />
            ) : (
              <TripRow k="Fare" v="Not priced — no route for this trip" />
            )}
          </Card>

          {existing && !editing ? (
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
              {feedbackStillEditable(existing) ? (
                <>
                  <Hint>
                    Tapped the wrong star? You can change this for {FEEDBACK_EDIT_WINDOW_HOURS} hours. Your driver never
                    sees who rated them.
                  </Hint>
                  <SecondaryButton label="Change my feedback" onPress={startEditing} />
                </>
              ) : (
                <Hint>This can no longer be changed — it was sent more than {FEEDBACK_EDIT_WINDOW_HOURS} hours ago.</Hint>
              )}
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
                accessibilityLabel="Anything else about this ride (optional)"
                placeholderTextColor={colors.textTertiary}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                  borderRadius: 12,
                  padding: 14,
                  fontSize: 15,
                  minHeight: 56,
                  color: colors.text,
                }}
              />
              <Hint>
                You can change this for {FEEDBACK_EDIT_WINDOW_HOURS} hours after sending, then it's fixed. It's never
                shown to your driver individually.
              </Hint>
            </Card>
          )}

          {existing && !editing && (
            <Pressable onPress={() => router.push({ pathname: '/(rider)/tracking', params: { rideId } })} style={{ alignSelf: 'flex-start' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary }}>View ride timeline</Text>
            </Pressable>
          )}
        </ScrollView>

          {!reported && ride?.matchedDriverId && (
            <Card>
              <SectionLabel>Did something go wrong?</SectionLabel>
              {reporting ? (
                <>
                  <Hint>What happened? This is separate from the star ratings.</Hint>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {INCIDENT_CATEGORIES.map((c) => (
                      <Chip
                        key={c.key}
                        label={c.label}
                        selected={reportCategory === c.key}
                        onPress={() => setReportCategory(c.key)}
                      />
                    ))}
                  </View>
                  <TextInput
                    value={reportDetails}
                    onChangeText={setReportDetails}
                    placeholder="Anything you want to add (optional)"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel="What happened"
                    multiline
                    style={{
                      borderWidth: 1,
                      borderColor: colors.borderStrong,
                      borderRadius: 12,
                      padding: 14,
                      fontSize: 15,
                      minHeight: 56,
                      color: colors.text,
                    }}
                  />
                  <Hint>
                    Sending this stops {riderFirstName === 'The rider' ? 'this rider' : 'you'} being matched with this
                    driver again. It can't be undone, and they're never told who reported them.
                  </Hint>
                  {reportError && (
                    <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={{ fontSize: 13, color: colors.alertDark }}>
                      {reportError}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <SecondaryButton label="Cancel" onPress={() => setReporting(false)} />
                    <View style={{ flex: 1 }}>
                      <PrimaryButton
                        label={submitting ? 'Sending…' : 'Send report'}
                        onPress={handleReport}
                        disabled={submitting || !reportCategory}
                      />
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <Hint>If you're in danger, call 911. Otherwise you can report this ride to us.</Hint>
                  <SecondaryButton label="Report a problem" onPress={() => setReporting(true)} />
                </>
              )}
            </Card>
          )}

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
          {existing && !editing ? (
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
