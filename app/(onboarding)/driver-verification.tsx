import { ReactNode, useState } from 'react';
import { router } from 'expo-router';
import { backOr } from '../../lib/nav';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Card, Hint, PrimaryButton, Screen, SectionLabel, SegmentedControl, TopBar } from '../../components/ui';
import { CarIcon, ScaleIcon, ShieldIcon, UsersIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';

// Super base-level, self-attested check (SPEC.md §5/§6): no real
// verification pipeline behind this yet — just a gate that makes clear
// what a driver is claiming before they can go available.
const QUESTIONS: { key: string; icon: ReactNode; text: string; critical: boolean }[] = [
  {
    key: 'weight',
    icon: <ScaleIcon size={20} color={colors.accentDark} />,
    text: 'Can you safely assist a rider who weighs up to 250 lbs during a transfer (e.g. wheelchair to seat)?',
    critical: true,
  },
  {
    key: 'olderAdult',
    icon: <UsersIcon size={20} color={colors.accentDark} />,
    text: 'Are you comfortable physically supporting an older adult while walking (e.g. an arm for balance)?',
    critical: true,
  },
  {
    key: 'lifting',
    icon: <CarIcon size={20} color={colors.accentDark} />,
    text: 'Can you lift or load a folded wheelchair or walker (about 35 lbs) into your trunk?',
    critical: true,
  },
  {
    key: 'experience',
    icon: <ShieldIcon size={20} color={colors.accentDark} />,
    text: 'Have you cared for or assisted a family member or client with a disability or mobility limitation?',
    critical: false,
  },
];

export default function DriverVerification() {
  const { setDriver } = useProfiles();
  const [answers, setAnswers] = useState<Record<string, string>>({
    weight: 'Yes',
    olderAdult: 'Yes',
    lifting: 'Yes',
    experience: 'Yes',
  });

  const anyCriticalNo = QUESTIONS.some((q) => q.critical && answers[q.key] === 'No');

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title="Basic Capability Check" onBack={() => backOr('/(driver)/driver-home')} />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ gap: 6 }}>
            <Text style={[type.heading, { color: colors.text }]}>Before you go available</Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>
              A few quick questions so riders know what to expect. This is self-reported for now — riders will rate your
              assistance after each trip, and a fuller verification step will replace this later.
            </Text>
          </View>

          {QUESTIONS.map((q) => (
            <Card key={q.key}>
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 0,
                  }}
                >
                  {q.icon}
                </View>
                <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text, lineHeight: 20 }}>{q.text}</Text>
              </View>
              <View style={{ width: 140, alignSelf: 'flex-end' }}>
                <SegmentedControl
                  options={['Yes', 'No']}
                  value={answers[q.key]}
                  onChange={(v) => setAnswers((prev) => ({ ...prev, [q.key]: v }))}
                />
              </View>
            </Card>
          ))}

          {anyCriticalNo && (
            <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
              <SectionLabel>Heads up</SectionLabel>
              <Hint>
                Based on these answers, some ride types (like wheelchair transfers) may not be matched to you. You can still
                finish setup and update this later.
              </Hint>
            </Card>
          )}
        </ScrollView>

        <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
          <PrimaryButton
            label="Finish Setup"
            onPress={() => {
              setDriver({ verificationAnswers: answers, verified: !anyCriticalNo });
              router.replace('/(driver)/driver-home');
            }}
          />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
