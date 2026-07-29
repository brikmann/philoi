import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGroup } from '@/hooks/use-group';
import { track } from '@/lib/analytics';
import { fetchInviteLink } from '@/lib/api/groups';

type InviteLink = { code: string; deepLink: string; webLink: string };

// The branded in-app invite screen (design-mocks/20, PHILOI_UI_SPEC.md §12) — the OS share
// sheet on its own showed a low-contrast code with no readable fallback; this shows the code
// clearly, copyable, before handing off to the (unthemeable) OS sheet.
export default function InviteScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { group } = useGroup(groupId);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [webLink, setWebLink] = useState<InviteLink | null>(null);

  const code = group?.join_code ?? '······';

  useEffect(() => {
    if (!group) return;
    fetchInviteLink(group.id, group.join_code).then(setWebLink);
  }, [group]);

  async function handleCopyCode() {
    await Clipboard.setStringAsync(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1500);
  }

  async function handleCopyLink() {
    if (!webLink) return;
    await Clipboard.setStringAsync(webLink.webLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1500);
  }

  async function handleShare() {
    if (!group || !webLink) return;
    setSharing(true);
    try {
      track('invite_sent', { group_id: group.id, source: 'invite_screen' });
      await Share.share({ message: `Join my Campfire on Philoi 🔥 Code: ${webLink.code} — or tap: ${webLink.webLink}` });
    } finally {
      setSharing(false);
    }
  }

  return (
    <Screen padded={false} style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.title}>Invite to your campfire</Text>
      </View>

      <View style={styles.hero}>
        <View style={styles.flameTile}>
          <Ionicons name="flame" size={28} color={Colors.amber} />
        </View>
        <Text style={styles.name}>{group?.name ?? '…'}</Text>
        <Text style={styles.sub}>Anyone with this code can join and lock in with you.</Text>
      </View>

      <Text style={styles.codeLabel}>CAMPFIRE CODE</Text>
      <View style={styles.codeCard}>
        <Text style={styles.codeValue}>{code}</Text>
        <Pressable onPress={handleCopyCode} style={styles.copyBtn} accessibilityLabel="Copy code">
          <Ionicons name={copiedCode ? 'checkmark' : 'copy-outline'} size={17} color={Colors.achieverText} />
        </Pressable>
      </View>

      {webLink && (
        <View style={styles.linkRow}>
          <Text style={styles.linkText} numberOfLines={1}>
            {webLink.webLink.replace('https://', '')}
          </Text>
          <Pressable onPress={handleCopyLink} accessibilityLabel="Copy link">
            <Ionicons name={copiedLink ? 'checkmark' : 'copy-outline'} size={15} color={Colors.achieverText} />
          </Pressable>
        </View>
      )}

      <View style={styles.spring} />

      <Pressable style={styles.shareBtn} onPress={handleShare} disabled={sharing || !group}>
        <Ionicons name="share-social" size={17} color={Colors.ink} />
        <Text style={styles.shareLabel}>{sharing ? 'Sharing…' : 'Share invite link'}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 15,
    paddingTop: 16,
    paddingBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
  },
  hero: {
    alignItems: 'center',
    marginTop: 14,
  },
  flameTile: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
    marginTop: 10,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 3,
    lineHeight: 16.8,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  codeLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 7,
  },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  codeValue: {
    flex: 1,
    fontFamily: Fonts.displayHeavy,
    fontSize: 24,
    letterSpacing: 5,
    color: Colors.ink,
  },
  copyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginTop: 9,
  },
  linkText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.soloChipText,
  },
  spring: {
    flex: 1,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.coral,
    borderRadius: 14,
    paddingVertical: 15,
  },
  shareLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
});
