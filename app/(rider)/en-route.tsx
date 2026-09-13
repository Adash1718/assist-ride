import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Avatar, Card, Chip, Hint, IconButton, Screen, SecondaryButton, TopBar } from '../../components/ui';
import { ClockIcon, MessageIcon, PhoneIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { initialsFrom } from '../../lib/format';
import {
  cancelRideRequest,
  fetchMatchedDriver,
  fetchRideRequest,
  MatchedDriverInfo,
  newerRide,
  RideRequestData,
  RideStatus,
  subscribeToRide,
} from '../../lib/rideApi';

// The rider's live view of a matched ride: follows the driver's progress
// (on the way → arrived → riding) via Realtime as the driver advances it on
// their active-ride screen, and moves to the completion screen when the
// driver completes the ride.
const STATUS_COPY: Partial<Record<RideStatus, { title: string; pill: string; banner: string }>> = {
  matched: { title: 'Driver Assigned', pill: 'Matched', banner: 'Getting ready to leave' },
  driver_en_route: { title: 'Driver On The Way', pill: 'En route', banner: 'On the way' },
  arrived: { title: 'Your Driver Is Here', pill: 'Arrived', banner: 'Your driver has arrived' },
  in_progress: { title: 'Ride In Progress', pill: 'Riding', banner: 'Heading to your dropoff' },
};

export default function DriverEnRoute() {
  const { rider } = useProfiles();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [ride, setRide] = useState<RideRequestData | null>(null);
  const [driverInfo, setDriverInfo] = useState<MatchedDriverInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const leaving = useRef(false);

  useEffect(() => {
    if (!rideId) return;
    // Subscribe before fetching so an update landing in between isn't lost.
    const unsubscribe = subscribeToRide(rideId, (updated) => setRide((prev) => newerRide(prev, updated)));
    (async () => {
      const { data } = await fetchRideRequest(rideId);
      if (data) setRide((prev) => newerRide(prev, data));
      if (data?.matchedDriverId) {
        const { data: info } = await fetchMatchedDriver(data.matchedDriverId);
        setDriverInfo(info);
      }
      setLoading(false);
    })();
    return unsubscribe;
  }, [rideId]);

  const status = ride?.status;
  useEffect(() => {
    if (leaving.current) return;
    if (status === 'completed') {
      leaving.current = true;
      router.replace({ pathname: '/(rider)/complete', params: { rideId } });
    } else if (status === 'cancelled' || status === 'no_show') {
      leaving.current = true;
      router.replace('/(rider)/home');
    }
  }, [status]);

  const copy = (status && STATUS_COPY[status]) || STATUS_COPY.matched!;
  const riding = status === 'in_progress';
  const driverName = driverInfo?.fullName.trim() || 'Your driver';
  const driverFirstName = driverName.split(' ')[0];
  const vehicleLine = driverInfo?.vehicle.trim()
    ? `${driverInfo.vehicle} · ${driverInfo.rampEquipped === 'Yes' ? 'Wheelchair ramp van' : 'No ramp/lift'} · Plate ${driverInfo.plate || '—'}`
    : 'Vehicle details unavailable';
  const driverTags = driverInfo?.capabilityTags ?? [];
  const riderFirstName = rider.fullName.trim().split(' ')[0] || 'the rider';
  const pinDigits = (ride?.pin ?? '----').split('');

  if (loading) return null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar
          title={copy.title}
          onBack={() => router.back()}
          right={
            <View style={{ backgroundColor: colors.positiveSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.positiveDark }}>{copy.pill}</Text>
            </View>
          }
        />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
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

          {!riding && (
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

          <Card>
            <Hint>
              We shared {riderFirstName}'s photo &amp; description with {driverFirstName} so they can recognize {riderFirstName} at
              pickup.
            </Hint>
          </Card>
        </ScrollView>

        {!riding && (
          <View style={{ padding: spacing.lg, alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
            <SecondaryButton
              label="Cancel Ride"
              onPress={async () => {
                leaving.current = true;
                if (rideId) await cancelRideRequest(rideId);
                router.replace('/(rider)/home');
              }}
            />
            <Text style={{ fontSize: 12, color: colors.textTertiary }}>Free to cancel for the next 12 min</Text>
          </View>
        )}
      </SafeAreaView>
    </Screen>
  );
}
