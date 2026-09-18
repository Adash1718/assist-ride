import { Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { Card, Hint, SectionLabel } from './ui';
import { CameraIcon, MapPinIcon, UsersIcon } from './Icon';
import { RideRequestData } from '../lib/rideApi';

// What a driver needs to know about a ride, shared by the incoming-request
// and active-ride screens (SPEC.md §3.D: the driver sees the rider's needs
// before arriving, not at the curb).

function needTags(ride: RideRequestData): string[] {
  const s = ride.needsSnapshot;
  return [s.mobilityAid && s.mobilityAid !== 'None' ? s.mobilityAid : null, ...(s.communicationNeeds ?? []), ...(s.assistanceNeeds ?? [])].filter(
    (n): n is string => !!n
  );
}

export function RiderNeedsCard({ ride }: { ride: RideRequestData }) {
  const needs = needTags(ride);
  return (
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
      {/* Matching (0010) guarantees this driver meets the ride's hard
          requirements, but a service animal is never a filter — it's a legal
          obligation — so say so where the driver decides. */}
      {(ride.needsSnapshot.assistanceNeeds ?? []).includes('Service animal') && (
        <Hint>The rider is travelling with a service animal, which can't be refused.</Hint>
      )}
    </Card>
  );
}

export function RecognizeRiderCard({ ride }: { ride: RideRequestData }) {
  const description = ride.needsSnapshot.idDescription?.trim() || 'No description on file.';
  return (
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
  );
}

export function TripCard({ ride }: { ride: RideRequestData }) {
  return (
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
      {ride.rideNotes?.trim() ? <Hint>"{ride.rideNotes}"</Hint> : null}
    </Card>
  );
}
