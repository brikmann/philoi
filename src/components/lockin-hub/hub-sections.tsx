import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PersonDisc } from '@/components/lockin-hub/person-disc';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts } from '@/constants/theme';
import { formatPeopleHours, type PeopleActiveNow, type PeopleWeek } from '@/lib/api/home';
import { formatRelativeTime } from '@/lib/format';
import type { AgoraItem, SocialChallenge } from '@/types/database';

// THE LOCK IN HUB'S SECTIONS (mock 347, ShareSpot ss4 §A). Presentational: the tab screen owns the
// reads, these draw them. Order on the screen is you → your people → the feed → challenges →
// the opt-in Standings row, so nobody opens the tab on somebody else's number.

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

// ───────────────────────────── your people ─────────────────────────────

/**
 * "🔥 Your people are on a roll · 5,042 hrs locked in together this week · 12 going right now".
 * One collective number — nobody ranked in it. The "going right now" tail only appears when
 * someone is, and says nothing when you've hidden your own live status (it's reciprocal).
 */
export function HubPeopleCard({ week, now }: { week: PeopleWeek | null; now: PeopleActiveNow | null }) {
  if (!week || week.people === 0) return null;
  const live = now && !now.youHidden && now.count > 0 ? now.count : 0;
  return (
    <View style={styles.people}>
      <View style={styles.peopleHead}>
        <NavGlyph name="flame" size={18} color={Colors.navEmber} />
        <Text style={styles.peopleTitle}>
          {week.thisWeekSeconds >= 3600 ? 'Your people are on a roll' : 'Your people are getting going'}
        </Text>
      </View>
      <Text style={styles.peopleBig}>{formatPeopleHours(week.thisWeekSeconds)}</Text>
      <Text style={styles.peopleSub}>
        locked in together this week{live > 0 ? ` · ${live.toLocaleString('en-US')} going right now` : ''}
      </Text>
      {week.faces.length > 0 ? (
        <View style={styles.faces}>
          {week.faces.slice(0, 6).map((f, i) => (
            <View key={f.userId} style={[styles.face, i > 0 && styles.faceOverlap]}>
              <PersonDisc name={f.name} avatarUrl={f.avatarUrl} size={26} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ───────────────────────────── study season feed ─────────────────────────────

function displayName(it: AgoraItem): string {
  return (it.display_name ?? '').trim() || it.handle || 'A friend';
}

/**
 * The feed of lock-in / study-season posts — a feed, not a stat sheet. A one-line "Share your
 * lock-in…" prompt at its head opens the composer; each post is who · when · what they said, with
 * the comment and cheer counts. Tapping a post opens it.
 */
export function HubFeed({ items, onCompose }: { items: AgoraItem[]; onCompose: () => void }) {
  const router = useRouter();
  return (
    <View style={styles.feed}>
      <Pressable style={styles.compose} onPress={onCompose} accessibilityRole="button" accessibilityLabel="Share your lock-in">
        <Text style={styles.composeText}>Share your lock-in…</Text>
        <NavGlyph name="pencil" size={18} color={Colors.navEmber2} />
      </Pressable>
      {items.length === 0 ? (
        <Text style={styles.feedEmpty}>When your people post a session, it lands here.</Text>
      ) : (
        items.map((it) => (
          <Pressable
            key={it.id}
            style={({ pressed }) => [styles.post, pressed && styles.pressed]}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/agora/[id]', params: { id: it.id, type: it.item_type } })}>
            <View style={styles.postHead}>
              <PersonDisc name={displayName(it)} avatarUrl={it.avatar_url} size={34} />
              <View style={styles.postWho}>
                <Text style={styles.postName} numberOfLines={1}>
                  {displayName(it)}
                </Text>
                <Text style={styles.postMeta} numberOfLines={1}>
                  {[it.audience === 'campfire' || it.audience === 'forest' ? it.audience_name : it.university, formatRelativeTime(it.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
            {it.body?.trim() ? (
              <Text style={styles.postBody} numberOfLines={3}>
                {it.body.trim()}
              </Text>
            ) : null}
            <View style={styles.postFoot}>
              <Text style={styles.postStat}>💬 {it.comments}</Text>
              <Text style={styles.postStat}>{it.cheers > 0 ? `🔥 ${it.cheers}` : it.cheered ? '🔥' : 'cheer them on'}</Text>
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

// ───────────────────────────── challenges ─────────────────────────────

function challengeTitle(c: SocialChallenge): string {
  if (c.public_name?.trim()) return c.public_name.trim();
  if (c.shape === 'duel' || c.mode === 'h2h') return `Duel with ${c.opponent_name ?? 'a friend'}`;
  return c.circle_name ? `${c.circle_name} challenge` : 'Challenge';
}

function challengeLine(c: SocialChallenge): string {
  const parts: string[] = [];
  if (c.status === 'pending') parts.push('waiting on an answer');
  else if (c.shape !== 'duel' && c.mode !== 'h2h' && c.member_count) parts.push(`${c.member_count} in`);
  if (c.ends_at) {
    const d = new Date(c.ends_at);
    parts.push(`ends ${d.toLocaleDateString(undefined, { weekday: 'long' })}`);
  }
  return parts.join(' · ');
}

/** Duel a friend first (the one thing you can always start), then the challenges you're in. */
export function HubChallenges({ live }: { live: SocialChallenge[] }) {
  const router = useRouter();
  return (
    <View style={styles.challenges}>
      <Pressable
        style={({ pressed }) => [styles.duelCard, pressed && styles.pressed]}
        onPress={() => router.push('/duel')}
        accessibilityRole="button"
        accessibilityLabel="Duel a friend">
        <View style={styles.duelText}>
          <Text style={styles.duelTitle}>Duel a friend</Text>
          <Text style={styles.duelSub}>who logs more this week — pick someone</Text>
        </View>
        <View style={styles.duelPill}>
          <Text style={styles.duelPillText}>Start</Text>
        </View>
      </Pressable>
      {live.map((c) => (
        <Pressable
          key={c.id}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={() => router.push({ pathname: '/challenge-info/[challengeId]', params: { challengeId: c.id } })}
          accessibilityRole="button">
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {challengeTitle(c)}
            </Text>
            {challengeLine(c) ? (
              <Text style={styles.rowSub} numberOfLines={1}>
                {challengeLine(c)}
              </Text>
            ) : null}
          </View>
          <UiGlyph name="forward" size={13} color={Colors.spaceFaint} />
        </Pressable>
      ))}
    </View>
  );
}

// ───────────────────────────── standings (opt-in) ─────────────────────────────

/** A quiet row, never a board: "Standings · Leaderboards · off · opt-in ›". */
export function HubStandingsRow({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Leaderboards, ${on ? 'on' : 'off'}, opt-in`}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>Leaderboards</Text>
      </View>
      <Text style={[styles.optin, on && styles.optinOn]}>{on ? 'on' : 'off · opt-in'}</Text>
      <UiGlyph name="forward" size={13} color={Colors.spaceFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontFamily: Fonts.black,
    fontSize: 15,
    color: Colors.ink,
    marginTop: 22,
    marginBottom: 10,
  },
  pressed: {
    opacity: 0.88,
  },

  people: {
    backgroundColor: 'rgba(255,122,47,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,122,47,0.32)',
    borderRadius: 16,
    padding: 14,
  },
  peopleHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  peopleTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.navEmber2,
  },
  peopleBig: {
    fontFamily: Fonts.black,
    fontSize: 28,
    color: Colors.ink,
    marginTop: 6,
  },
  peopleSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  faces: {
    flexDirection: 'row',
    marginTop: 10,
  },
  face: {
    borderRadius: 14,
  },
  faceOverlap: {
    marginLeft: -8,
  },

  feed: {
    gap: 8,
  },
  compose: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  composeText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  feedEmpty: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
    paddingVertical: 6,
  },
  post: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 16,
    padding: 12,
  },
  postHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postWho: {
    flex: 1,
    minWidth: 0,
  },
  postName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  postMeta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
    marginTop: 1,
  },
  postBody: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: Colors.ink,
    marginTop: 9,
  },
  postFoot: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 9,
  },
  postStat: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
  },

  challenges: {
    gap: 8,
  },
  duelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(185,139,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(185,139,255,0.35)',
  },
  duelText: {
    flex: 1,
    minWidth: 0,
  },
  duelTitle: {
    fontFamily: Fonts.black,
    fontSize: 15,
    color: Colors.ink,
  },
  duelSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  duelPill: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: Colors.legend,
  },
  duelPillText: {
    fontFamily: Fonts.black,
    fontSize: 13,
    color: '#160D26',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
    marginTop: 2,
  },
  optin: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  optinOn: {
    color: Colors.green,
  },
});
