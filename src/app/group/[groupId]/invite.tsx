import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { CampfireBadge } from '@/components/campfire-badge';
import { SocialGlyph } from '@/components/ui/glyphs-social';
import { Screen } from '@/components/ui/screen';
import { SPACE_GUTTER, SpaceButton, SpaceCard, SpaceHeader, SpaceSection } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
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
      await Share.share({ message: `Join my Campfire on Philoi. Code: ${webLink.code} — or tap: ${webLink.webLink}` });
    } finally {
      setSharing(false);
    }
  }

  return (
    <Screen padded={false} style={styles.container}>
      <SpaceHeader title="Invite to your campfire" onBack={() => router.back()} />

      <View style={styles.body}>
        <View style={styles.hero}>
          {/* The campfire you are inviting people INTO, not the brand mark (mock 168). */}
          <CampfireBadge emoji={group?.emoji ?? '🔥'} heat={heatByGroupId[groupId] ?? 0} size={54} />
          <Text style={styles.name}>{group?.name ?? '…'}</Text>
          <Text style={styles.sub}>Anyone with this code can join and lock in with you.</Text>
        </View>

        <SpaceSection>Campfire code</SpaceSection>
        <SpaceCard style={styles.codeCard}>
          <Text style={styles.codeValue}>{code}</Text>
          <Pressable onPress={handleCopyCode} style={styles.copyBtn} accessibilityRole="button" accessibilityLabel="Copy code">
            {copiedCode ? (
              <UiGlyph name="check" size={17} color={Colors.gold} />
            ) : (
              <SocialGlyph name="copy" size={17} color={Colors.navEmber2} />
            )}
          </Pressable>
        </SpaceCard>

        {/* The raw URL line is GONE (mock 112 §B). A long link nobody is going to hand-type was
            taking a whole row to say what the code above and the Share button below already do —
            and it was still printing the old getphiloi.com domain. The link itself is unchanged and
            rides along inside Share. */}

        <View style={styles.spring} />

        <SpaceButton
          label="Share invite link"
          onPress={handleShare}
          disabled={!group}
          loading={sharing}
          leading={<UiGlyph name="share" size={17} color="#2A0F05" />}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Spacing.two,
    // Share sat on the safe-area line with nothing under it. SafeAreaView clears the home
    // indicator; this is the gap above it. (This modal hides the global bottom bar.)
    paddingBottom: Spacing.three,
  },
  body: {
    flex: 1,
    paddingHorizontal: SPACE_GUTTER,
  },
  hero: {
    alignItems: 'center',
    marginTop: 8,
  },
  name: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
    marginTop: 10,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    marginTop: 4,
    lineHeight: 17.5,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 15,
  },
  codeValue: {
    flex: 1,
    fontFamily: Fonts.displayHeavy,
    fontSize: 24,
    letterSpacing: 5,
    color: Colors.gold,
  },
  copyBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spring: {
    flex: 1,
  },
});
