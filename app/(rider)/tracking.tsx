import { ReactNode, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { backOr } from '../../lib/nav';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Avatar, Card, Hint, Screen, SectionLabel, TopBar } from '../../components/ui';
import { AlertCircleIcon, CarIcon, CheckIcon, ClockIcon, PhoneIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { initialsFrom } from '../../lib/format';
import {
  fetchMatchedDriver,
  fetchRideEvents,
  MatchedDriverInfo,
  RideEvent,
  RideStatus,
  subscribeToRideEvents,
} from '../../lib/rideApi';
import { useLiveRide } from '../../lib/useLiveRide';

// SPEC.md §3.F — the ride's timeline for whoever booked it: the rider today,
// a linked proxy once proxy accounts exist (the event log's RLS already keys
// off requested_by, the same check as ride_requests). Everything here comes
// from the trigger-written log in migration 0009; no ETA is shown because
// there's no routing/map data to base one on.

type StepState = 'done' | 'current' | 'pending';

// What a rider sees for each logged status. A second (or later) 'requested'
// means a driver handed the ride back before pickup, which is worth naming
// rather than repeating "Ride requested".
function stepLabel(status: RideStatus, isFirst: boolean, driverName: string | null): string {
  switch (status) {
    case 'requested':
      return isFirst ? 'Ride requested' : 'Driver cancelled — finding a new driver';
    case 'matched':
      return driverName ? `Matched with ${driverName}` : 'Driver assigned';
    case 'driver_en_route':
      return 'Driver on the way';
    case 'arrived':
      return 'Driver arrived at pickup';
    case 'in_progress':
      return 'Picked up';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Ride cancelled';
    case 'no_show':
      return 'Marked as a no-show';
    default:
      return status;
  }
}

// Steps still ahead, once the ride is under way.
const REMAINING_AFTER: Partial<Record<RideStatus, RideStatus[]>> = {
  requested: ['matched', 'driver_en_route', 'arrived', 'in_progress', 'completed'],
  matched: ['driver_en_route', 'arrived', 'in_progress', 'completed'],
  driver_en_route: ['arrived', 'in_progress', 'completed'],
  arrived: ['in_progress', 'completed'],
  in_progress: ['completed'],
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function callNumber(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits) Linking.openURL(`tel:${digits}`);
}

export default function RideTracking() {
  const { rider } = useProfiles();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { ride, loading } = useLiveRide(rideId);
  const [events, setEvents] = useState<RideEvent[]>([]);
  const [driverInfo, setDriverInfo] = useState<MatchedDriverInfo | null>(null);

  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    const unsubscribe = subscribeToRideEvents(rideId, (event) => {
      setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
    });
    (async () => {
      const { data } = await fetchRideEvents(rideId);
      if (cancelled) return;
      // Merge rather than replace: a live event may already have arrived.
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...data.filter((e) => !seen.has(e.id))].sort((a, b) => a.at.localeCompare(b.at));
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [rideId]);

  // Only readable while this driver is the ride's matched driver (RLS), so a
  // driver who handed the ride back can't be named after a reload — those
  // steps read "Driver assigned" instead.
  const matchedDriverId = ride?.matchedDriverId;
  useEffect(() => {
    if (!matchedDriverId) return;
    (async () => {
      const { data } = await fetchMatchedDriver(matchedDriverId);
      if (data) setDriverInfo(data);
    })();
  }, [matchedDriverId]);

  const riderFirstName = rider.fullName.trim().split(' ')[0] || 'this rider';
  const driverName = driverInfo?.fullName.trim() || null;
  const vehicleLine = driverInfo?.vehicle.trim()
    ? `${driverInfo.vehicle}${driverInfo.plate ? ` · Plate ${driverInfo.plate}` : ''}`
    : 'Vehicle details unavailable';

  if (loading) return null;

  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const lastStatus = sorted.length > 0 ? sorted[sorted.length - 1].status : ride?.status;
  const pending = (lastStatus && REMAINING_AFTER[lastStatus]) ?? [];
  const totalRows = sorted.length + pending.length;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title={`Tracking ${riderFirstName}'s Ride`} onBack={() => backOr('/(rider)/home')} />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Card>
            <SectionLabel>Status</SectionLabel>
            {sorted.length === 0 && <Hint>No status updates yet.</Hint>}
            {sorted.map((event, i) => {
              const isLastLogged = i === sorted.length - 1;
              const state: StepState = isLastLogged ? 'current' : 'done';
              return (
                <TimelineStep
                  key={event.id}
                  state={state}
                  // Only name the driver on a step that refers to the ride's
                  // current driver — an earlier match was a different driver
                  // (handed back since), whose profile RLS won't show us.
                  label={stepLabel(event.status, i === 0, event.driverId && event.driverId === matchedDriverId ? driverName : null)}
                  time={formatTime(event.at)}
                  icon={
                    state === 'done' ? (
                      <CheckIcon size={14} color={colors.positiveDark} />
                    ) : (
                      <CarIcon size={14} color={colors.accentDark} />
                    )
                  }
                  isLast={i === totalRows - 1}
                />
              );
            })}
            {pending.map((status, i) => (
              <TimelineStep
                key={`pending-${status}`}
                state="pending"
                label={stepLabel(status, false, driverName)}
                icon={<ClockIcon size={13} color={colors.textTertiary} />}
                isLast={sorted.length + i === totalRows - 1}
              />
            ))}
          </Card>

          <View
            style={{
              height: 130,
              borderRadius: 16,
              backgroundColor: colors.surfaceAlt,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Hint>Live map not available yet</Hint>
          </View>

          {driverName && (
            <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar initials={initialsFrom(driverName)} size={44} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={{ fontWeight: '700', fontSize: 15, color: colors.text }}>{driverName}</Text>
                <Hint>{vehicleLine}</Hint>
              </View>
            </Card>
          )}

          <Card>
            <Hint>This page updates itself as the ride progresses — no need to refresh.</Hint>
          </Card>

          <Card style={{ paddingVertical: 4, gap: 0 }}>
            {rider.phone.trim() !== '' && (
              <ContactRow
                icon={<PhoneIcon size={16} />}
                label={`Call ${riderFirstName}`}
                sublabel={rider.phone}
                onPress={() => callNumber(rider.phone)}
              />
            )}
            <ContactRow
              icon={<AlertCircleIcon size={16} color={colors.alertDark} />}
              label="Call 911"
              labelColor={colors.alertDark}
              sublabel="For real emergencies only"
              iconBg={colors.alertSoft}
              onPress={() => callNumber('911')}
              isLast
            />
          </Card>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function TimelineStep({
  state,
  label,
  time,
  icon,
  isLast,
}: {
  state: StepState;
  label: string;
  time?: string;
  icon?: ReactNode;
  isLast?: boolean;
}) {
  const dotBg = state === 'done' ? colors.positiveSoft : state === 'current' ? colors.accentSoft : colors.surfaceAlt;
  const labelColor = state === 'pending' ? colors.textTertiary : colors.text;
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: dotBg, alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </View>
        {!isLast && <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: colors.border }} />}
      </View>
      <View style={{ paddingBottom: isLast ? 0 : 22 }}>
        <Text style={{ fontWeight: '700', fontSize: 15, color: labelColor }}>{label}</Text>
        {time && <Text style={{ fontSize: 12.5, color: colors.textTertiary }}>{time}</Text>}
      </View>
    </View>
  );
}

function ContactRow({
  icon,
  label,
  sublabel,
  labelColor = colors.text,
  iconBg = colors.surfaceAlt,
  onPress,
  isLast,
}: {
  icon: ReactNode;
  label: string;
  sublabel?: string;
  labelColor?: string;
  iconBg?: string;
  onPress?: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 13,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <View>
        <Text style={{ fontWeight: '700', fontSize: 14.5, color: labelColor }}>{label}</Text>
        {sublabel && <Hint>{sublabel}</Hint>}
      </View>
    </Pressable>
  );
}
