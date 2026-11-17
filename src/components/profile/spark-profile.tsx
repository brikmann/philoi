import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BurningName } from '@/components/burning-name';
import { IdentityLine } from '@/components/house/identity-line';
import { AnthemChip, aspirationOf, WorkingToward } from '@/components/identity/identity-card';
import { ClubChips } from '@/components/profile/profile-clubs';
import { Colors, Fonts, Radius } from '@/constants/theme';
import type { Profile, TrophyHall } from '@/types/database';
import type { FeedChannel, ProfileIdentity } from '@/types/social';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE GYM SPARK PROFILE (v2 §8, mock 407) — information-forward, reads like a person:
//
//   identity row (avatar · name · "Heracles of Kinesiology" · @handle · school · Edit)
//   → Working toward → About (a line about you + anthem) → Locked in · Streak · PRs · Clubs
//   → Clubs chips
//
// No card/flare composite, no Trophy Hall, no Showcase PR tiles, no relic/medal cards, no rank
// strip. Every section reads data that already exists and fails soft to "not drawn":
//   - patron line   → IdentityLine 'epic' (get_identity_badges: patron + program)
//   - working toward→ profile identity (0272) aspiration: working_toward ▸ career_goal ▸ working_on
//   - About line    → identity.working_on (the bio's replacement since F13), edited at /edit-identity
//   - anthem        → identity.anthem
//   - stats         → trophy hall (total_seconds, current_streak), showcase PR count, clubs length
//   - clubs         → get_my_feed_channels (0280) — own profile only, visitors can't read it
//
// Only the composition is new; the pieces are the legacy profile's own.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const AVATAR = 64;

export function SparkProfileBody({
  profile,
  isOwn,
  identity,
  hall,
  prCount,
  clubs,
  onEdit,
}: {
  profile: Profile;
  isOwn: boolean;
  identity: ProfileIdentity | null;
  hall: TrophyHall | null;
  /** Own profile only (the showcase read is owner-scoped); null = unknown. */
  prCount: number | null;
  /** Own profile only; null = unknown or not readable. */
  clubs: FeedChannel[] | null;
  onEdit: () => void;
}) {
  return (
    <View>
      <IdentityRow profile={profile} isOwn={isOwn} onEdit={onEdit} />
      <WorkingToward identity={identity} />
      <SparkAbout identity={identity} />
      <SparkStats hall={hall} prCount={isOwn ? prCount : null} clubs={isOwn ? clubs : null} showOwnOnly={isOwn} />
      {isOwn && clubs ? (
        <>
          <Text style={styles.sect}>Clubs</Text>
          {clubs.length > 0 ? <ClubChips clubs={clubs} /> : <Text style={styles.quiet}>Not in a club yet.</Text>}
        </>
      ) : null}
    </View>
  );
}

function IdentityRow({ profile, isOwn, onEdit }: { profile: Profile; isOwn: boolean; onEdit: () => void }) {
  const router = useRouter();
  const name = profile.display_name || profile.handle || '';
  const meta = [profile.handle ? `@${profile.handle}` : null, profile.university].filter(Boolean).join(' · ');
  // Patron is chosen here now (it left onboarding, v2 §1). No patron on your own profile → a gentle
  // prompt where the line would be; a visitor's missing patron is just no line.
  const needsPatron = isOwn && !profile.patron_key;

  return (
    <View style={styles.idRow}>
      <View style={styles.avatar}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Text style={styles.initial}>{name.charAt(0).toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.idText}>
        {/* Two lines before an ellipsis — a full name beside the Edit pill must not read "Noah Brik…". */}
        <BurningName userId={profile.id} style={styles.name} numberOfLines={2}>
          {name}
        </BurningName>
        {needsPatron ? (
          <Pressable
            onPress={() => router.push('/house/patron' as never)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Pick your patron">
            <Text style={styles.pickPatron}>Pick your patron ›</Text>
          </Pressable>
        ) : (
          <IdentityLine userId={profile.id} form="epic" numberOfLines={2} style={styles.patron} />
        )}
        {meta ? (
          <Text style={styles.meta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
      </View>
      {isOwn ? (
        <Pressable
          onPress={onEdit}
          hitSlop={6}
          style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Edit profile">
          <Text style={styles.editText}>Edit</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** About — one line about you (identity.working_on, unless it's already the aspiration) + the anthem. */
function SparkAbout({ identity }: { identity: ProfileIdentity | null }) {
  const router = useRouter();
  if (!identity || !identity.identity_visible) return null;
  const aspiration = aspirationOf(identity);
  const on = identity.working_on?.trim();
  const line = on && on !== aspiration ? on : null;
  const anthem = identity.anthem?.title ? identity.anthem : null;

  if (!line && !anthem) {
    if (!identity.is_self) return null;
    return (
      <>
        <Text style={styles.sect}>About</Text>
        <Pressable onPress={() => router.push('/edit-identity' as never)} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.quiet}>Add a line about you and your anthem ›</Text>
        </Pressable>
      </>
    );
  }

  return (
    <>
      <Text style={styles.sect}>About</Text>
      {line ? <Text style={styles.bio}>{line}</Text> : null}
      {anthem ? (
        <View style={line ? styles.anthemGap : null}>
          <AnthemChip anthem={anthem} />
        </View>
      ) : null}
    </>
  );
}

/**
 * Locked in · Streak · PRs · Clubs. PRs and Clubs are owner-scoped reads, so a visitor sees the two
 * that are public. Drawn once the hall loads; a still-loading owner-only figure shows "—".
 */
function SparkStats({
  hall,
  prCount,
  clubs,
  showOwnOnly,
}: {
  hall: TrophyHall | null;
  prCount: number | null;
  clubs: FeedChannel[] | null;
  showOwnOnly: boolean;
}) {
  if (!hall) return null;
  const seconds = hall.stats.total_seconds;
  const lockedIn = seconds >= 3600 ? `${Math.floor(seconds / 3600).toLocaleString()}h` : `${Math.floor(seconds / 60)}m`;
  return (
    <View style={styles.stats}>
      <Stat value={lockedIn} label="Locked in" />
      <Stat value={String(hall.stats.current_streak)} label="Streak" />
      {showOwnOnly ? <Stat value={prCount === null ? '—' : String(prCount)} label="PRs" /> : null}
      {showOwnOnly ? <Stat value={clubs === null ? '—' : String(clubs.length)} label="Clubs" /> : null}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginTop: 6,
    marginHorizontal: 2,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: 'hidden',
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: Fonts.display,
    fontSize: AVATAR * 0.42,
    color: Colors.ember,
  },
  idText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  name: {
    fontFamily: Fonts.black,
    fontSize: 19,
    lineHeight: 23,
    color: Colors.ink,
    flexShrink: 1,
  },
  patron: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  pickPatron: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  meta: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  edit: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,176,90,0.45)',
  },
  editText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.navEmber2,
  },
  pressed: {
    opacity: 0.75,
  },
  sect: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 2,
  },
  bio: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    marginHorizontal: 2,
  },
  anthemGap: {
    marginTop: 10,
  },
  quiet: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    marginHorizontal: 2,
  },
  stats: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 16,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingVertical: 13,
    paddingHorizontal: 4,
  },
  statValue: {
    fontFamily: Fonts.black,
    fontSize: 19,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.spaceDim,
    marginTop: 2,
  },
});
