import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Card, Hint, Screen, SecondaryButton, TopBar } from '../../components/ui';
import { CarIcon, CheckIcon, ClockIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { ACTIVE_RIDE_STATUSES, cancelRideRequest } from '../../lib/rideApi';
import { useLiveRide } from '../../lib/useLiveRide';

export default function Matching() {
  const { rider } = useProfiles();
  const { rideId, notice } = useLocalSearchParams<{ rideId: string; notice?: string }>();
  const { ride } = useLiveRide(rideId);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);
  const riderFirstName = rider.fullName.trim().split(' ')[0] || 'this rider';
  const afterDriverCancel = notice === 'driver_cancelled';

  // Real matching: wait for a driver to accept this exact ride row (any
  // available driver can see it — see SPEC.md for capability-tag filtering
  // as a documented next step). No polling — Realtime pushes the update, and
  // useLiveRide's fetch covers a driver who accepted before the subscription
  // was live. This is also where a ride lands after its driver hands it back
  // before pickup: it's simply back in the search.
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

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title={afterDriverCancel ? 'Finding a New Driver' : 'Finding a Driver'} onBack={() => router.back()} />

        {afterDriverCancel && (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.accentDark }}>Your driver had to cancel</Text>
              <Hint>Your ride is still booked — you don't need to rebook. We're matching you with a new driver now.</Hint>
            </Card>
          </View>
        )}

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

        <View style={{ padding: spacing.lg, gap: 8 }}>
          {error && <Hint>{error}</Hint>}
          <SecondaryButton label={cancelling ? 'Cancelling…' : 'Cancel Request'} onPress={handleCancel} />
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
