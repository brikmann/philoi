import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import type { Anthem, ProfileIdentity } from '@/types/social';

// Mock 283's identity card — the "who you are" under the momentum strip: working toward, working
// on, the anthem chip, interests. Each row is optional and each is a small social hook (a goal a
// friend can cheer or dare against, a song, a tag in common), so an absent field is an absent row
// rather than a labelled blank.
//
// Your own card with nothing filled in turns into one gentle prompt into /edit-identity; anyone
// else's empty — or dial-hidden — card is not drawn at all.

function AnthemChip({ anthem }: { anthem: Anthem }) {
  const url = anthem.url ?? null;
  const body = (
    <View style={styles.anthem}>
      <View style={styles.art}>
        <Text style={styles.artGlyph}>♪</Text>
      </View>
      <View style={styles.anthemText}>
        <Text style={styles.anthemTitle} numberOfLines={1}>
          {anthem.title}
        </Text>
        <Text style={styles.anthemSub} numberOfLines={1}>
          {anthem.artist ? `${anthem.artist} · ` : ''}my grind song
        </Text>
      </View>
      {url ? <Ionicons name="open-outline" size={13} color={Colors.textTertiary} /> : null}
    </View>
  );
  if (!url) return body;
  return (
    // The server only stores an https open.spotify.com / music.apple.com link (0272), so this
    // can't be steered anywhere else.
    <Pressable
      onPress={() => void Linking.openURL(url).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={`Play ${anthem.title}`}>
      {body}
    </Pressable>
  );
}

function Field({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.field, last && styles.fieldLast]}>
      <Text style={styles.k}>{label}</Text>
      <View style={styles.v}>{children}</View>
    </View>
  );
}

export function IdentityCard({ identity }: { identity: ProfileIdentity | null }) {
  const router = useRouter();
  if (!identity || !identity.identity_visible) return null;

  const toward = identity.working_toward?.trim();
  const on = identity.working_on?.trim();
  const anthem = identity.anthem?.title ? identity.anthem : null;
  const interests = (identity.interests ?? []).filter(Boolean);

  const rows: { key: string; label: string; node: ReactNode }[] = [];
  if (toward) rows.push({ key: 'toward', label: 'Working toward', node: <Text style={styles.vText}>{toward}</Text> });
  if (on) rows.push({ key: 'on', label: 'Working on', node: <Text style={styles.vSoft}>{on}</Text> });
  if (anthem) rows.push({ key: 'anthem', label: 'Anthem', node: <AnthemChip anthem={anthem} /> });
  if (interests.length > 0) {
    rows.push({
      key: 'interests',
      label: 'Into',
      node: (
        <View style={styles.tags}>
          {interests.map((t) => (
            <View key={t} style={styles.tag}>
              <Text style={styles.tagText}>{t}</Text>
            </View>
          ))}
        </View>
      ),
    });
  }

  if (rows.length === 0) {
    if (!identity.is_self) return null;
    return (
      <Pressable
        style={[styles.card, styles.prompt]}
        onPress={() => router.push('/edit-identity' as never)}
        accessibilityRole="button"
        accessibilityLabel="Add what you're working toward">
        <Ionicons name="sparkles-outline" size={15} color={Colors.ember} />
        <View style={styles.promptText}>
          <Text style={styles.promptTitle}>Add what you&apos;re working toward</Text>
          <Text style={styles.promptSub}>A goal, a song, what you&apos;re into — so people see who you are.</Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      {rows.map((r, i) => (
        <Field key={r.key} label={r.label} last={i === rows.length - 1}>
          {r.node}
        </Field>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 3,
  },
  field: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  fieldLast: {
    borderBottomWidth: 0,
  },
  // Mock 283's fixed-width key column, so the values line up down the card.
  k: {
    width: 76,
    flexShrink: 0,
    paddingTop: 2,
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
  },
  v: {
    flex: 1,
    minWidth: 0,
  },
  vText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
  },
  vSoft: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
  },
  anthem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  // Mock 283's green "now playing" tile. A flat green rather than the mock's gradient: one chip
  // doesn't earn an SVG, and the premium visualizer skins are a later cosmetic slot.
  art: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: '#14A44A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artGlyph: {
    fontSize: 14,
    color: Colors.ink,
  },
  anthemText: {
    flex: 1,
    minWidth: 0,
  },
  anthemTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ink,
  },
  anthemSub: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  tag: {
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  tagText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.coldChipText,
  },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
  },
  promptText: {
    flex: 1,
    minWidth: 0,
  },
  promptTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  promptSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
});
