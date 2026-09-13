import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Card, Divider, Hint, PrimaryButton, Screen, SectionLabel } from '../../components/ui';
import { CheckIcon, StarIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';

function StarRow({ value, onChange, size = 16 }: { value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={4}>
          <StarIcon size={size} filled={n <= value} color={n <= value ? colors.accent : colors.border} />
        </Pressable>
      ))}
    </View>
  );
}

export default function RideComplete() {
  const { rider } = useProfiles();
  const riderFirstName = rider.fullName.trim().split(' ')[0] || 'The rider';
  const [mobilityRating, setMobilityRating] = useState(4);
  const [patienceRating, setPatienceRating] = useState(5);
  const [vehicleRating, setVehicleRating] = useState(5);
  const [overall, setOverall] = useState(5);
  const [comment, setComment] = useState('');

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
            <Hint>{riderFirstName} arrived safely at Riverside Medical Center</Hint>
          </View>

          <Card>
            <TripRow k="Pickup" v="123 Maple Street" />
            <TripRow k="Dropoff" v="Riverside Medical Center" />
            <Divider />
            <TripRow k="Duration" v="22 min" />
            <TripRow k="Fare" v="$19.50" />
          </Card>

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

            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Anything else you'd like to share? (optional)"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 14,
                fontSize: 15,
                minHeight: 56,
                color: colors.text,
              }}
            />
          </Card>
        </ScrollView>

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
          <PrimaryButton label="Submit Feedback" onPress={() => router.replace('/(rider)/home')} />
          <Pressable onPress={() => router.replace('/(rider)/home')}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary }}>Skip for now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Screen>
  );
}

function TripRow({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 14, color: colors.textSecondary }}>{k}</Text>
      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{v}</Text>
    </View>
  );
}

function RateRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, maxWidth: 180 }}>{label}</Text>
      <StarRow value={value} onChange={onChange} />
    </View>
  );
}
