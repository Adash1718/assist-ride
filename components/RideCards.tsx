import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { Card, Hint, SectionLabel } from './ui';
import { MapPinIcon, UsersIcon } from './Icon';
import { fetchEmergencyAccessForRide, formatFee, RideRequestData } from '../lib/rideApi';
import { driverEarningsCents } from '../lib/fare';
import { formatDistance, formatDuration } from '../lib/geoApi';

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
      {/* The rider's standing note. Their profile asks for this under
          "Anything drivers should always know?", so not showing it here made
          that question a lie — it was collected and never delivered. */}
      {ride.needsSnapshot.standingNotes?.trim() ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.accentDark, letterSpacing: 0.3 }}>ALWAYS</Text>
          <Text style={{ fontSize: 14, color: colors.text, lineHeight: 20 }}>{ride.needsSnapshot.standingNotes}</Text>
        </View>
      ) : null}
    </Card>
  );
}

export function RecognizeRiderCard({ ride }: { ride: RideRequestData }) {
  const description = ride.needsSnapshot.idDescription?.trim() || 'No description on file.';
  return (
    <Card>
      <SectionLabel>Recognizing the rider</SectionLabel>
      {/* Description only — identification photos are deferred (0012), so a
          photo placeholder here would promise something that never arrives. */}
      <Text style={{ fontSize: 13.5, color: colors.textSecondary, lineHeight: 19 }}>{description}</Text>
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
      {/* Real numbers from the route looked up when the ride was booked
          (0023), or nothing at all. The old "~8 min" here was invented and
          was deleted for that reason — an absent ETA beats a made-up one. */}
      {ride.routeMeters != null && ride.routeSeconds != null && (
        <Hint>
          About {formatDistance(ride.routeMeters)} · {formatDuration(ride.routeSeconds)} driving
        </Hint>
      )}
      {/* What this ride pays the driver, on the offer screen where they
          decide. The service premium is funded by the platform, never added
          to the rider's fare (lib/fare.ts) — a driver spending fifteen
          minutes on a transfer shouldn't earn the same as a kerbside drop,
          and the rider shouldn't be charged for needing the help. */}
      {ride.fareEstimateCents != null && (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>You earn</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>
              {formatFee(driverEarningsCents(ride.fareEstimateCents, ride.driverPremiumCents ?? 0))}
            </Text>
          </View>
          {(ride.driverPremiumCents ?? 0) > 0 && (
            <Hint>
              Includes {formatFee(ride.driverPremiumCents ?? 0)} for the assistance this ride needs — paid by us, not by
              the rider.
            </Hint>
          )}
        </>
      )}
      {ride.rideNotes?.trim() ? <Hint>"{ride.rideNotes}"</Hint> : null}
    </Card>
  );
}

// Rider-facing counterpart to the driver's emergency-contacts card: the
// profile screen promises "we'll tell you if they do", and this is where that
// promise is kept. Renders nothing in the normal case where nobody looked.
export function EmergencyAccessNotice({ rideId }: { rideId: string }) {
  const [views, setViews] = useState<string[]>([]);

  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    (async () => {
      const { data } = await fetchEmergencyAccessForRide(rideId);
      if (!cancelled) setViews(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId]);

  if (views.length === 0) return null;

  const when = new Date(views[0]).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <Card style={{ backgroundColor: colors.alertSoft, borderColor: colors.alert }}>
      <SectionLabel>Your emergency contacts were opened</SectionLabel>
      <Hint>
        Your driver opened your emergency contacts at {when}
        {views.length > 1 ? ` (and ${views.length - 1} more ${views.length === 2 ? 'time' : 'times'})` : ''}. They can see a
        contact's name and number until this ride ends.
      </Hint>
    </Card>
  );
}
