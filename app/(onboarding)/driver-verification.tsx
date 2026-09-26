import { ReactNode, useState } from 'react';
import { router } from 'expo-router';
import { backOr } from '../../lib/nav';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../../constants/theme';
import { Card, Hint, PrimaryButton, Screen, SectionLabel, SegmentedControl, TopBar } from '../../components/ui';
import { CarIcon, ScaleIcon, ShieldIcon, UsersIcon } from '../../components/Icon';
import { useProfiles } from '../../contexts/ProfileContext';
import { useAuth } from '../../contexts/AuthContext';
import { saveDriverProfile } from '../../lib/profileApi';

// A self-declaration, NOT a verification (SPEC.md §5/§6): there is no
// checking pipeline behind it. Three things were wrong with it and all three
// mattered, because what a driver claims here decides which vulnerable riders
// they get matched to:
//   * every answer was pre-filled "Yes", so a driver could tap Finish without
//     reading and the app recorded four affirmative claims about physically
//     handling people. Answers now start UNSET and the button stays disabled
//     until each one is deliberately chosen.
//   * the answers were only written to in-memory context and never saved, so
//     Driver Home's profile fetch overwrote them moments later. Nothing this
//     screen collected ever reached the database.
//   * it set `verified: true`, which is a claim the app cannot make. The
//     column now records only that a declaration was completed.
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
  const { driver, setDriver } = useProfiles();
  const { user } = useAuth();
  // Unset on purpose — see the note above. A blank answer is an honest "we
  // haven't asked yet"; a pre-filled "Yes" is the app putting words in a
  // driver's mouth about whether they can safely lift someone.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const anyCriticalNo = QUESTIONS.some((q) => q.critical && answers[q.key] === 'No');
  const allAnswered = QUESTIONS.every((q) => answers[q.key] === 'Yes' || answers[q.key] === 'No');

  async function handleFinish() {
    const next = { ...driver, verificationAnswers: answers, verified: allAnswered };
    setDriver({ verificationAnswers: answers, verified: allAnswered });
    if (user) {
      setSaving(true);
      setSaveError(null);
      const { error } = await saveDriverProfile(user.id, next);
      setSaving(false);
      if (error) {
        // Don't move on pretending this was recorded — that's how the answers
        // silently vanished before.
        setSaveError(error);
        return;
      }
    }
    router.replace('/(driver)/driver-home');
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title="Basic Capability Check" onBack={() => backOr('/(driver)/driver-home')} />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ gap: 6 }}>
            <Text style={[type.heading, { color: colors.text }]}>Before you go available</Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>
              These are your own answers about what you can safely do — nobody checks them, and riders are told that.
              They decide which riders you're matched with, so please answer honestly rather than generously: someone
              relying on a "yes" here may not be able to get out of the car without it.
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
                  value={answers[q.key] ?? ''}
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
          {saveError && <Hint>{saveError}</Hint>}
          {!allAnswered && <Hint>Please answer each question before finishing.</Hint>}
          <PrimaryButton
            label={saving ? 'Saving…' : 'Finish Setup'}
            onPress={handleFinish}
            disabled={!allAnswered || saving}
          />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
