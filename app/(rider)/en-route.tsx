import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { backOr } from '../../lib/nav';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Avatar, Card, Chip, Hint, IconButton, Screen, SecondaryButton, TopBar } from '../../components/ui';
import { ClockIcon, MessageIcon, PhoneIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { initialsFrom } from '../../lib/format';
import { cancelRideRequest, fetchMatchedDriver, MatchedDriverInfo, RideStatus } from '../../lib/rideApi';
import { useLiveRide } from '../../lib/useLiveRide';

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

export default function DriverEnRoute() {
  const { rider } = useProfiles();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { ride, loading } = useLiveRide(rideId);
  const [driverInfo, setDriverInfo] = useState<MatchedDriverInfo | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);

  // Kept after a driver cancel clears matched_driver_id, so the message can
  // say who cancelled; replaced when a new driver is matched.
  const matchedDriverId = ride?.matchedDriverId;
  useEffect(() => {
    if (!matchedDriverId) return;
    (async () => {
      const { data } = await fetchMatchedDriver(matchedDriverId);
      if (data) setDriverInfo(data);
    })();
  }, [matchedDriverId]);

  const status = ride?.status;
  useEffect(() => {
    if (leaving.current) return;
    if (!loading && !ride) {
      leaving.current = true;
      router.replace('/(rider)/home');
    } else if (status === 'completed') {
      leaving.current = true;
      router.replace({ pathname: '/(rider)/complete', params: { rideId } });
    } else if (status === 'cancelled' || status === 'no_show') {
      leaving.current = true;
      router.replace({ pathname: '/(rider)/home', params: { notice: 'cancelled' } });
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

  const copy = (status && STATUS_COPY[status]) || STATUS_COPY.matched!;
  const riding = status === 'in_progress';
  const driverCancelled = status === 'requested';
  const driverName = driverInfo?.fullName.trim() || 'Your driver';
  const driverFirstName = driverName.split(' ')[0];
  const vehicleLine = driverInfo?.vehicle.trim()
    ? `${driverInfo.vehicle} · ${driverInfo.rampEquipped === 'Yes' ? 'Wheelchair ramp van' : 'No ramp/lift'} · Plate ${driverInfo.plate || '—'}`
    : 'Vehicle details unavailable';
  const driverTags = driverInfo?.capabilityTags ?? [];
  const riderFirst = rider.fullName.trim().split(' ')[0];
  const riderFirstName = riderFirst || 'the rider';
  const pinDigits = (ride?.pin ?? '----').split('');

  if (loading || !ride) return null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar
          title={copy.title}
          onBack={() => backOr('/(rider)/home')}
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
          {driverCancelled && (
            <Card style={{ backgroundColor: colors.alertSoft, borderColor: colors.alert }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.alertDark }}>{driverFirstName} had to cancel</Text>
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
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{copy.banner}</Text>
            </View>
          </View>

          {!driverCancelled && (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar initials={initialsFrom(driverName)} size={52} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>{driverName}</Text>
                </View>
                <IconButton>
                  <PhoneIcon size={18} />
                </IconButton>
                <IconButton>
                  <MessageIcon size={18} />
                </IconButton>
              </View>
              <Hint>{vehicleLine}</Hint>
              {driverTags.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {driverTags.map((tag) => (
                    <Chip key={tag} label={tag} />
                  ))}
                </View>
              )}
            </Card>
          )}

          {!riding && !driverCancelled && (
            <Card style={{ alignItems: 'center' }}>
              <Text style={type.sectionLabel}>Share this PIN at pickup</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
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
              <Hint>{driverFirstName} will confirm this before starting the ride.</Hint>
            </Card>
          )}

          {!driverCancelled && (
            <Card>
              <Hint>
                We shared {riderFirstName}'s photo &amp; description with {driverFirstName} so they can recognize {riderFirstName} at
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
          <View style={{ padding: spacing.lg, alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
            {error && <Hint>{error}</Hint>}
            <SecondaryButton label={cancelling ? 'Cancelling…' : 'Cancel Ride'} onPress={handleCancel} />
            <Text style={{ fontSize: 12, color: colors.textTertiary }}>Free to cancel for the next 12 min</Text>
          </View>
        )}
      </SafeAreaView>
    </Screen>
  );
}
