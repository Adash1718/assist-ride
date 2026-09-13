import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Card, Hint, Screen, SecondaryButton, TopBar } from '../../components/ui';
import { CarIcon, CheckIcon, ClockIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { ACTIVE_RIDE_STATUSES, cancelRideRequest, fetchRideRequest, RideRequestData, subscribeToRide } from '../../lib/rideApi';

export default function Matching() {
  const { rider } = useProfiles();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const riderFirstName = rider.fullName.trim().split(' ')[0] || 'this rider';

  // Real matching: wait for a driver to accept this exact ride row (any
  // available driver can see it — see SPEC.md for capability-tag filtering
  // as a documented next step). No polling — Realtime pushes the update,
  // plus one fetch after subscribing in case a driver accepted before the
  // subscription was live.
  useEffect(() => {
    if (!rideId) return;
    let left = false;
    const route = (ride: RideRequestData) => {
      if (left) return;
      if (ACTIVE_RIDE_STATUSES.includes(ride.status)) {
        left = true;
        router.replace({ pathname: '/(rider)/en-route', params: { rideId } });
      } else if (ride.status === 'completed') {
        left = true;
        router.replace({ pathname: '/(rider)/complete', params: { rideId } });
      } else if (ride.status === 'cancelled') {
        left = true;
        router.replace('/(rider)/home');
      }
    };
    const unsubscribe = subscribeToRide(rideId, route);
    (async () => {
      const { data } = await fetchRideRequest(rideId);
      if (data) route(data);
    })();
    return () => {
      left = true;
      unsubscribe();
    };
  }, [rideId]);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title="Finding a Driver" onBack={() => router.back()} />

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CarIcon size={32} color={colors.accentDark} />
          </View>

          <View style={{ alignItems: 'center', gap: 8 }}>
            <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>
              Looking for a driver{'\n'}who can help {riderFirstName}
            </Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
              This may take a little longer than a standard ride — we're matching a specially qualified driver.
            </Text>
          </View>

          <Card style={{ width: '100%' }}>
            <MatchRow label="Ride request sent" done />
            <MatchRow label="Waiting for a driver to accept…" done={false} />
          </Card>

          <Hint>You'll move to the next screen the moment a driver accepts.</Hint>
        </View>

        <View style={{ padding: spacing.lg }}>
          <SecondaryButton
            label="Cancel Request"
            onPress={async () => {
              if (rideId) await cancelRideRequest(rideId);
              router.replace('/(rider)/home');
            }}
          />
        </View>
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
      <Text style={{ fontSize: 14, fontWeight: '600', color: done ? colors.text : colors.textSecondary }}>{label}</Text>
    </View>
  );
}
