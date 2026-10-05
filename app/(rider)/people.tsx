import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { Avatar, Card, Hint, PrimaryButton, Screen, SecondaryButton, SectionLabel, TopBar } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { backOr } from '../../lib/nav';
import { initialsFrom } from '../../lib/format';
import { fetchRiderProfile } from '../../lib/profileApi';
import {
  acceptProxyInvite,
  fetchLinksForMe,
  fetchMyProxies,
  inviteProxy,
  leaveProxyLink,
  ProxyLink,
  revokeProxy,
} from '../../lib/proxyApi';

// Proxy access in both directions (SPEC.md §1, migration 0017): who may book
// for me, and who I may book for. One screen, because they're the same
// relationship seen from either end, and an account can be both.
export default function People() {
  const { user } = useAuth();
  const [mine, setMine] = useState<ProxyLink[]>([]);
  const [forMe, setForMe] = useState<ProxyLink[]>([]);
  const [riderNames, setRiderNames] = useState<Record<string, string>>({});
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const myEmail = (user?.email ?? '').toLowerCase();

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: ownLinks }, { data: allLinks }] = await Promise.all([fetchMyProxies(user.id), fetchLinksForMe()]);
    setMine(ownLinks);
    // Links where I'm the other side: invites addressed to my email, and
    // riders I've already accepted. RLS returns both from the same query.
    const others = allLinks.filter((l) => l.riderId !== user.id);
    setForMe(others);
    // Names for the riders I act for — readable only once accepted (0017).
    const accepted = others.filter((l) => l.status === 'accepted' && l.proxyId === user.id);
    const names: Record<string, string> = {};
    await Promise.all(
      accepted.map(async (l) => {
        const { data } = await fetchRiderProfile(l.riderId);
        if (data?.fullName) names[l.riderId] = data.fullName;
      })
    );
    setRiderNames(names);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Coming back from booking for someone else should show current state.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleInvite() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: err } = await inviteProxy(user.id, email);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setNotice(`Invitation sent to ${email.trim().toLowerCase()}. They'll see it when they sign in.`);
    setEmail('');
    load();
  }

  async function handleRevoke(link: ProxyLink) {
    setBusy(true);
    setError(null);
    const { error: err } = await revokeProxy(link.id);
    setBusy(false);
    if (err) setError(err);
    else {
      setNotice(`${link.proxyEmail} can no longer book for you.`);
      load();
    }
  }

  async function handleAccept(link: ProxyLink) {
    if (!user) return;
    setBusy(true);
    setError(null);
    const { error: err } = await acceptProxyInvite(link.id, user.id);
    setBusy(false);
    if (err) setError(err);
    else load();
  }

  async function handleLeave(link: ProxyLink) {
    if (!user) return;
    setBusy(true);
    setError(null);
    const { error: err } = await leaveProxyLink(link.id, user.id);
    setBusy(false);
    if (err) setError(err);
    else load();
  }

  const invites = forMe.filter((l) => l.status === 'pending' && l.proxyEmail.toLowerCase() === myEmail);
  const ridersIActFor = forMe.filter((l) => l.status === 'accepted' && l.proxyId === user?.id);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <TopBar title="People" onBack={() => backOr('/(rider)/home')} />

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {error && (
            <Card style={{ backgroundColor: colors.alertSoft, borderColor: colors.alert }}>
              <Hint>{error}</Hint>
            </Card>
          )}
          {notice && (
            <Card style={{ backgroundColor: colors.positiveSoft, borderColor: colors.positive }}>
              <Hint>{notice}</Hint>
            </Card>
          )}

          {invites.length > 0 && (
            <Card style={{ borderColor: colors.accent, backgroundColor: colors.accentSoft }}>
              <SectionLabel>Invitations for you</SectionLabel>
              <Hint>Someone has asked you to book and track rides on their behalf.</Hint>
              {invites.map((link) => (
                <View key={link.id} style={{ gap: 10 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>A rider invited you to help</Text>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <SecondaryButton label="Decline" onPress={() => handleLeave(link)} />
                    <View style={{ flex: 1 }}>
                      <PrimaryButton label={busy ? 'Accepting…' : 'Accept'} onPress={() => handleAccept(link)} disabled={busy} />
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          )}

          <Card>
            <SectionLabel>Who can book for you</SectionLabel>
            <Hint>
              A caregiver or family member can book rides, follow them, and cancel if plans change. They can't change your profile or
              see your emergency contacts.
            </Hint>

            {mine.length === 0 ? (
              <Hint>Nobody yet.</Hint>
            ) : (
              mine.map((link) => (
                <View key={link.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Avatar initials={initialsFrom(link.proxyEmail)} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{link.proxyEmail}</Text>
                    <Hint>{link.status === 'accepted' ? 'Can book for you' : 'Invited — waiting for them to accept'}</Hint>
                  </View>
                  <SecondaryButton label="Remove" onPress={() => handleRevoke(link)} />
                </View>
              ))
            )}

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="their@email.com"
              accessibilityLabel="Email address of the person who can book for you"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              keyboardType="email-address"
              style={{
                borderWidth: 1,
                borderColor: colors.borderStrong,
                borderRadius: 12,
                padding: 14,
                fontSize: 15,
                color: colors.text,
                backgroundColor: colors.surface,
              }}
            />
            <PrimaryButton label={busy ? 'Inviting…' : 'Invite'} onPress={handleInvite} disabled={busy || email.trim() === ''} />
            <Hint>They need an Assist Ride account with this email address.</Hint>
          </Card>

          {ridersIActFor.length > 0 && (
            <Card>
              <SectionLabel>You can book for</SectionLabel>
              {ridersIActFor.map((link) => (
                <View key={link.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Avatar initials={initialsFrom(riderNames[link.riderId] ?? 'R')} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{riderNames[link.riderId] ?? 'Rider'}</Text>
                    <Hint>You can book and track their rides</Hint>
                  </View>
                  <SecondaryButton
                    label="Book"
                    onPress={() => router.push({ pathname: '/(rider)/book', params: { forRiderId: link.riderId } })}
                  />
                </View>
              ))}
              <Hint>Stepping down is up to you — tap a rider's name in their app, or ask them to remove you.</Hint>
            </Card>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
