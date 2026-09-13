import { router } from 'expo-router';
import { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Avatar, Card, Hint, Screen, SectionLabel, TopBar } from '../../components/ui';
import { AlertCircleIcon, CarIcon, CheckIcon, MessageIcon, PhoneIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { initialsFrom } from '../../lib/format';

type StepState = 'done' | 'current' | 'pending';

const FALLBACK_DRIVER_NAME = 'James O.';
const FALLBACK_VEHICLE = 'Silver Honda Odyssey';

export default function ProxyTracking() {
  const { rider, driver } = useProfiles();
  const riderFirstName = rider.fullName.trim().split(' ')[0] || 'this rider';
  const driverName = driver.fullName.trim() || FALLBACK_DRIVER_NAME;
  const vehicle = driver.vehicle.trim() || FALLBACK_VEHICLE;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title={`Tracking ${riderFirstName}'s Ride`} onBack={() => router.back()} />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Card>
            <SectionLabel>Status</SectionLabel>
            <TimelineStep state="done" label="Requested" time="2:04 PM" icon={<CheckIcon size={14} color={colors.positiveDark} />} />
            <TimelineStep
              state="done"
              label={`Matched with ${driverName}`}
              time="2:06 PM"
              icon={<CheckIcon size={14} color={colors.positiveDark} />}
            />
            <TimelineStep state="current" label="Driver arriving" time="~8 min" icon={<CarIcon size={14} color={colors.accentDark} />} />
            <TimelineStep state="pending" label="Picked up" isLast={false} />
            <TimelineStep state="pending" label="Completed" isLast />
          </Card>

          <View
            style={{
              height: 130,
              borderRadius: 16,
              backgroundColor: colors.surfaceAlt,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          />

          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar initials={initialsFrom(driverName)} size={44} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={{ fontWeight: '700', fontSize: 15, color: colors.text }}>
                {driverName} · {vehicle}
              </Text>
              <Hint>Arriving in ~8 min</Hint>
            </View>
          </Card>

          <Card>
            <Hint>You'll get a notification at every step, since you're not riding along.</Hint>
          </Card>

          <Card style={{ paddingVertical: 4, gap: 0 }}>
            <ContactRow icon={<PhoneIcon size={16} />} label={`Call ${riderFirstName}`} />
            <ContactRow icon={<MessageIcon size={16} />} label="Message Driver" />
            <ContactRow
              icon={<AlertCircleIcon size={16} color={colors.alertDark} />}
              label="Call 911"
              labelColor={colors.alertDark}
              sublabel="For real emergencies only"
              iconBg={colors.alertSoft}
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
  isLast,
}: {
  icon: ReactNode;
  label: string;
  sublabel?: string;
  labelColor?: string;
  iconBg?: string;
  isLast?: boolean;
}) {
  return (
    <View
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
    </View>
  );
}
