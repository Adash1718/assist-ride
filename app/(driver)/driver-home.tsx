import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Avatar, Card, Hint, IconButton, Screen, TopBar } from '../../components/ui';
import { LogOutIcon, PencilIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { useAuth } from '../../contexts/AuthContext';
import { initialsFrom } from '../../lib/format';
import { ensureDriverProfileRow, fetchDriverProfile, isDriverProfileComplete, setDriverAvailability } from '../../lib/profileApi';
import { fetchActiveRideForDriver, fetchOldestOpenRequest, subscribeToIncomingRequests } from '../../lib/rideApi';

export default function DriverHome() {
  const { driver, setDriver } = useProfiles();
  const { session, loading, signOut } = useAuth();
  const [available, setAvailable] = useState(false);
  // What the database has confirmed, as opposed to what the toggle shows.
  // Matching must key off this one: RLS decides which open rides the
  // catch-up fetch can see from the persisted is_available column, so
  // fetching the instant the toggle flips (before the write lands) comes
  // back empty and silently misses any ride that was already waiting.
  const [confirmedAvailable, setConfirmedAvailable] = useState(false);
  const latestToggle = useRef(false);
  const [checking, setChecking] = useState(true);

  const userId = session?.user?.id;

  // Re-verify against the database on every visit here — not just trust
  // whatever ProfileContext happens to hold — so a driver can never reach
  // availability/accepting rides without having actually finished profile
  // setup, regardless of how they got to this URL. Depends on the user id
  // (a stable primitive), not the whole session object, which Supabase
  // replaces with a new reference on every token refresh — depending on the
  // object itself would re-run this on every refresh for no reason, and (see
  // below) a transient failure during one of those re-runs must never be
  // treated the same as "no profile exists".
  useEffect(() => {
    if (loading) return;
    if (!userId) {
      router.replace('/');
      return;
    }
    (async () => {
      const { data, error } = await fetchDriverProfile(userId);
      if (data) setDriver(data);
      if (error) {
        // Transient fetch failure — never bounce an already-set-up driver to
        // onboarding just because one request hiccuped.
        setChecking(false);
        return;
      }
      if (!isDriverProfileComplete(data)) {
        if (!data) await ensureDriverProfileRow(userId);
        router.replace('/(onboarding)/driver');
        return;
      }
      const isAvailable = data?.isAvailable ?? false;
      latestToggle.current = isAvailable;
      setAvailable(isAvailable);
      setConfirmedAvailable(isAvailable); // read straight from the DB, so already persisted
      setChecking(false);
    })();
  }, [loading, userId]);

  async function toggleAvailable(next: boolean) {
    latestToggle.current = next;
    setAvailable(next); // optimistic for the toggle itself
    if (!next) setConfirmedAvailable(false); // stop matching immediately when going offline
    if (!userId) return;
    const { error } = await setDriverAvailability(userId, next);
    if (latestToggle.current !== next) return; // toggled again while this write was in flight
    if (error) {
      setAvailable(!next);
      latestToggle.current = !next;
      return;
    }
    if (next) setConfirmedAvailable(true);
  }

  // Matching runs only while this screen is FOCUSED, not merely mounted:
  // Driver Home stays mounted underneath the incoming/active-ride screens
  // pushed on top of it, and a subscription living here would keep offering
  // rides from underneath — double-booking a driver who's mid-ride, or
  // stacking one offer on top of another.
  //
  // On every focus: a driver with an active ride goes straight back to it
  // and is offered nothing new (see ACTIVE_RIDE_STATUSES). Otherwise, while
  // confirmed available, (a) subscribe to rides that become open — new
  // requests, and rides another driver handed back before pickup — and (b)
  // catch up on any ride ALREADY open (a driver late to come online, or
  // back here right after declining) — RLS already excludes rides this
  // driver declined, and (0010) rides this driver can't actually serve, so
  // either path only surfaces a ride that's genuinely theirs to take.
  useFocusEffect(
    useCallback(() => {
      if (checking || !userId) return;
      let cancelled = false;
      let offered = false;
      let unsubscribe: (() => void) | null = null;
      const offer = (rideId: string) => {
        if (cancelled || offered) return; // catch-up and the subscription can both find the same ride
        offered = true;
        router.push({ pathname: '/(driver)/incoming', params: { rideId } });
      };
      (async () => {
        const { data: active, error } = await fetchActiveRideForDriver(userId);
        if (cancelled) return;
        if (active) {
          router.replace({ pathname: '/(driver)/active-ride', params: { rideId: active.id } });
          return;
        }
        // If we couldn't confirm there's no active ride, don't offer one.
        if (error || !confirmedAvailable) return;
        unsubscribe = subscribeToIncomingRequests((ride) => offer(ride.id));
        const { data } = await fetchOldestOpenRequest();
        if (data) offer(data.id);
      })();
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    }, [checking, userId, confirmedAvailable])
  );

  if (checking) return null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar
          title="Assist Ride"
          right={
            <IconButton
              onPress={async () => {
                await signOut();
                router.replace('/');
              }}
            >
              <LogOutIcon />
            </IconButton>
          }
        />

        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg }}>
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar initials={initialsFrom(driver.fullName)} size={52} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{driver.fullName || 'Set up your profile'}</Text>
              <Hint>{driver.vehicle || 'No vehicle on file'}{driver.rampEquipped === 'Yes' ? ' · Wheelchair ramp van' : ''}</Hint>
            </View>
            <IconButton onPress={() => router.push('/(driver)/driver-profile')}>
              <PencilIcon size={16} />
            </IconButton>
          </Card>

          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg }}>
            <View
              style={{
                width: 140,
                height: 140,
                borderRadius: 70,
                backgroundColor: available ? colors.positiveSoft : colors.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <Switch
                value={available}
                onValueChange={toggleAvailable}
                trackColor={{ false: colors.border, true: colors.positive }}
                thumbColor={colors.surface}
              />
              <Text style={{ fontSize: 13, fontWeight: '700', color: available ? colors.positiveDark : colors.textSecondary }}>
                {available ? 'Available' : 'Offline'}
              </Text>
            </View>

            <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>
              {available ? "You're online" : "You're offline"}
            </Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', maxWidth: 260 }}>
              {available
                ? 'Waiting for a ride request that matches your vehicle and capabilities.'
                : 'Go available to start receiving specialized ride requests.'}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </Screen>
  );
}
