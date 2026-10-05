import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { backOr } from '../lib/nav';
import { colors, spacing } from '../constants/theme';
import { Hint, PrimaryButton, Screen, TopBar } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useLiveRide } from '../lib/useLiveRide';
import { fetchRideMessages, MESSAGE_MAX_LENGTH, RideMessage, sendRideMessage, subscribeToRideMessages } from '../lib/messageApi';

// The ride's message thread, shared by both sides (migration 0022). One
// screen rather than a rider copy and a driver copy: the only difference is
// whose messages sit on the right, and two copies of a chat is two places for
// it to drift.
//
// `title` is the other person's name, passed by whichever screen opened this
// — each side already knows it, and neither can read the other's profile row
// directly (0018).
const SENDABLE = ['matched', 'driver_en_route', 'arrived', 'in_progress'];

export default function RideChat() {
  const { rideId, title } = useLocalSearchParams<{ rideId: string; title?: string }>();
  const { user } = useAuth();
  const { ride } = useLiveRide(rideId);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    (async () => {
      const { data } = await fetchRideMessages(rideId);
      if (!cancelled) setMessages(data);
    })();
    // Subscribe as well as fetch: the fetch covers anything said before this
    // screen opened, the subscription everything after.
    const unsubscribe = subscribeToRideMessages(rideId, (message) => {
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [rideId]);

  const canSend = !!ride && SENDABLE.includes(ride.status);

  async function handleSend() {
    if (!rideId || !user || draft.trim() === '') return;
    setSending(true);
    setError(null);
    const { data, error: err } = await sendRideMessage(rideId, user.id, draft);
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setDraft('');
    // Show it straight away rather than waiting for the echo; the subscription
    // de-duplicates by id if it arrives too.
    if (data) setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title={title?.trim() ? `Messages with ${title}` : 'Messages'} onBack={() => backOr('/')} />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {messages.length === 0 && (
              <Hint>
                No messages yet. Anything you send here goes to them directly — you don't need to share a phone number.
              </Hint>
            )}
            {messages.map((m) => {
              const mine = m.senderId === user?.id;
              return (
                <View
                  key={m.id}
                  style={{
                    alignSelf: mine ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    backgroundColor: mine ? colors.accent : colors.surface,
                    borderWidth: mine ? 0 : 1,
                    borderColor: colors.border,
                    borderRadius: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    gap: 4,
                  }}
                >
                  <Text style={{ fontSize: 15, lineHeight: 21, color: mine ? colors.surface : colors.text }}>{m.body}</Text>
                  <Text style={{ fontSize: 11, color: mine ? colors.surface : colors.textTertiary, opacity: mine ? 0.8 : 1 }}>
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          <View
            style={{
              padding: spacing.lg,
              gap: 10,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            {error && <Hint>{error}</Hint>}
            {canSend ? (
              <>
                <TextInput
                  value={draft}
                  onChangeText={(t) => setDraft(t.slice(0, MESSAGE_MAX_LENGTH))}
                  placeholder="Type a message"
                  accessibilityLabel="Message"
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  style={{
                    borderWidth: 1,
                    borderColor: colors.borderStrong,
                    borderRadius: 12,
                    padding: 14,
                    fontSize: 15,
                    minHeight: 48,
                    color: colors.text,
                  }}
                />
                <PrimaryButton label={sending ? 'Sending…' : 'Send'} onPress={handleSend} disabled={sending || draft.trim() === ''} />
              </>
            ) : (
              <Hint>This ride has ended. You can still read what was said, but no new messages can be sent.</Hint>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
