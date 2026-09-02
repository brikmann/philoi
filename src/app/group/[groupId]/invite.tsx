import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { CampfireBadge } from '@/components/campfire-badge';
import { EmberFill } from '@/components/ui/ember-fill';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCampfireHeat } from '@/hooks/use-campfire-heat';
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
  const heatByGroupId = useCampfireHeat();
  const [copiedCode, setCopiedCode] = useState(false);
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
        {/* The campfire you are inviting people INTO, not the brand mark (mock 168). */}
        <CampfireBadge emoji={group?.emoji ?? '🔥'} heat={heatByGroupId[groupId] ?? 0} size={54} />
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

      {/* The raw URL line is GONE (mock 112 §B). A long link nobody is going to hand-type was
          taking a whole row to say what the code above and the Share button below already do —
          and it was still printing the old getphiloi.com domain. The link itself is unchanged and
          rides along inside Share. */}

      <View style={styles.spring} />

      <Pressable onPress={handleShare} disabled={sharing || !group} accessibilityRole="button">
        <EmberFill
          style={[styles.shareBtn, (sharing || !group) && styles.shareBtnBusy]}
          radius={Radius.button}
          direction="diagonal">
          <Ionicons name="share-social" size={17} color={Colors.onEmber} />
          <Text style={styles.shareLabel}>{sharing ? 'Sharing…' : 'Share invite link'}</Text>
        </EmberFill>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 15,
    paddingTop: 16,
    // Share sat on the safe-area line with nothing under it. SafeAreaView clears the home
    // indicator; this is the gap above it.
    paddingBottom: Spacing.three,
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
  spring: {
    flex: 1,
  },
  // §3 · EMBER GRADIENT, NOT FLAT AMBER.
  //
  // This carried a comment claiming it was "the ember treatment" while painting
  // `backgroundColor: Colors.amber` — one flat yellow. DESIGN_LANGUAGE_EMBER §3's primary is the
  // amber→coral GRADIENT (what PrimaryButton and the FAB paint); a solid amber slab is the
  // washed-out thing the rule exists to abolish, and it has now been reported three times. The
  // fill is <EmberFill> now, so there is no colour here to drift back.
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: 15,
  },
  shareBtnBusy: {
    opacity: 0.6,
  },
  shareLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.onEmber,
  },
});
