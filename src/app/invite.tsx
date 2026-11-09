import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { INVITE_DOMAIN } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';

// INVITE FRIENDS (ShareSpot mock 369) — the density engine, one tap. Your share link is
// philoi.app/join/{username} (no @ in a URL). The mock's "from your contacts" list needs
// expo-contacts, a native module this build doesn't carry; it's a follow-up for the next binary.
// Until then, "Find by username" covers people already on Philoi.

export default function InviteScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [copied, setCopied] = useState(false);
  const handle = profile?.handle?.replace(/^@+/, '').trim() ?? '';
  const link = handle ? `${INVITE_DOMAIN}/join/${handle}` : null;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Invite friends</Text>
        <View style={{ width: 20 }} />
      </View>

      <View style={styles.body}>
        <Text style={styles.emoji}>🤝</Text>
        <Text style={styles.h}>Bring your people</Text>
        <Text style={styles.p}>Philoi’s better with your crew. Share your link — they land right next to you.</Text>

        {link ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Your invite</Text>
            <Text style={styles.link} selectable>
              {link}
            </Text>
            <View style={styles.row}>
              <Pressable
                style={styles.btn}
                onPress={async () => {
                  await Clipboard.setStringAsync(`https://${link}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                accessibilityRole="button">
                <Text style={styles.btnText}>{copied ? 'Copied ✓' : 'Copy'}</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => void Share.share({ message: `Join me on Philoi — https://${link}` })}
                accessibilityRole="button">
                <Text style={[styles.btnText, styles.btnTextPrimary]}>Share</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={styles.p}>Pick a username first and your link will show up here.</Text>
        )}

        <Pressable style={styles.secondary} onPress={() => router.push('/add-friend')} accessibilityRole="button">
          <Text style={styles.secondaryText}>Find someone by username ›</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: 10 },
  back: { fontSize: 28, color: Colors.ink, marginTop: -4 },
  title: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink },
  body: { padding: Spacing.four, alignItems: 'center', gap: 10 },
  emoji: { fontSize: 44, marginTop: Spacing.three },
  h: { fontFamily: Fonts.black, fontSize: 22, color: Colors.ink },
  p: { fontFamily: Fonts.body, fontSize: 13.5, lineHeight: 19, color: Colors.muted, textAlign: 'center' },
  card: {
    alignSelf: 'stretch',
    marginTop: Spacing.three,
    padding: 16,
    gap: 10,
    borderRadius: 18,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  cardLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.spaceDim },
  link: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.navEmber2 },
  row: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  btnPrimary: { backgroundColor: Colors.navEmber, borderColor: Colors.navEmber },
  btnText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.ink },
  btnTextPrimary: { color: Colors.onEmber },
  secondary: { marginTop: Spacing.three, paddingVertical: 10 },
  secondaryText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.navEmber2 },
});
