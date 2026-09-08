import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyGroups } from '@/hooks/use-my-groups';
import { fetchCampfireMembers } from '@/lib/api/groups';
import { createTeamMatch, fetchMatchSports } from '@/lib/api/team-match';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { CampfireMember, DifficultyTier, MatchSport, TeamMatchScoreMode } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CREATE A TEAM MATCH — mock 177 §A (CODE_PROMPT_team_mode.md §5, migration 0173).
//
// ITS OWN SCREEN RATHER THAN A FOURTH BRANCH OF challenge/create.tsx. The three shapes that screen
// owns share a spine — a metric, a bar, a window, a payout line — and a team match has none of the
// four. It has a sport, two teams, a scorekeeper and two tiers. Folding it in would have meant
// four `shape === 'team'` guards around fields it never shows and a submit path with nothing in
// common with the other three. The Team tile on that screen routes here, so there is still one
// door into creation; it just opens onto a different room.
//
// 🔒 NOTHING HERE DECIDES A PAYOUT. The form sends two tier NAMES ('uncommon' / 'common') and the
// server prices both out of economy_config.tier_payout at settlement — the same firewall 0159 put
// around Cindy's proposals. The chips below say what the tiers are called, never what they pay.
//
// ADMIN-GATED, AND SAID OUT LOUD. create_team_match re-reads the caller's role out of
// group_members and refuses a non-admin. The form greys its own button for the same reason
// challenge/create.tsx does — so the rule is visible before the tap, not only in the refusal.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The two sides' colours, kept away from the theme tokens on purpose: these are TEAM KIT
 *  colours a user picks, not surface colours the retheme should cascade through. Hex, because
 *  that is what the column stores and validates. */
const TEAM_COLORS = ['#FF6B5C', '#6BB8FF', '#63D68A', '#FFD27A', '#C9A0F0', '#F27ABF'] as const;

/** The tier ladder, in order, so "winners a rarity above losers" is a real relationship rather
 *  than two independent pickers that can be set to contradict each other. */
const TIER_LADDER: DifficultyTier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

const TIER_LABEL: Record<DifficultyTier, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
};

export default function TeamMatchCreateScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { groups } = useMyGroups();
  const params = useLocalSearchParams<{ circleId?: string; groupId?: string }>();
  // Both names, for the same reason challenge/create.tsx reads both: the campfire sends `groupId`
  // and the challenge screens send `circleId`, and a create screen that landed on the wrong
  // campfire would post the match into a fire nobody at the game is in.
  const prefillCircleId = params.circleId ?? params.groupId ?? null;

  const [sports, setSports] = useState<MatchSport[] | null>(null);
  const [sportKey, setSportKey] = useState('soccer');
  const [customSport, setCustomSport] = useState('');
  // Null means "the user hasn't picked one" — the deep-link's campfire is then the answer, and
  // groups[0] after that. DERIVED rather than an effect that setStates the prefill in once
  // `groups` loads: that effect fires on the render after the fetch and can only ever restate
  // something already knowable from the props it depends on.
  const [pickedCircle, setPickedCircle] = useState<number | null>(null);
  const [teamAName, setTeamAName] = useState('Red Team');
  const [teamBName, setTeamBName] = useState('Blue Team');
  const [teamAColor, setTeamAColor] = useState<string>(TEAM_COLORS[0]);
  const [teamBColor, setTeamBColor] = useState<string>(TEAM_COLORS[1]);
  const [scoreMode, setScoreMode] = useState<TeamMatchScoreMode>('confirm');
  const [loserTier, setLoserTier] = useState<DifficultyTier>('common');
  const [refUserId, setRefUserId] = useState<string | null>(null);
  // KEYED BY CAMPFIRE, not a bare list. The alternative — clearing it at the top of the fetch
  // effect — is a setState inside an effect body, and it is also the weaker behaviour: this way a
  // roster can never be shown against the campfire it did not come from, even for one frame.
  const [members, setMembers] = useState<{ circleId: string; rows: CampfireMember[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prefillIndex = prefillCircleId ? groups.findIndex((g) => g.id === prefillCircleId) : -1;
  const circleIndex = pickedCircle ?? (prefillIndex >= 0 ? prefillIndex : 0);
  const circle = groups[circleIndex];
  const myUserId = session?.user.id ?? null;
  const roster = members?.circleId === circle?.id ? members.rows : null;

  // Winners are ALWAYS one rung above losers, and there is only one picker for that reason. Two
  // free pickers let a host set winners below losers (the server refuses it) or equal to them (it
  // does not, but "everyone gets the same" is a different feature and not one mock 177 asks for).
  const winnerTier: DifficultyTier =
    TIER_LADDER[Math.min(TIER_LADDER.indexOf(loserTier) + 1, TIER_LADDER.length - 1)];

  useEffect(() => {
    let alive = true;
    fetchMatchSports()
      .then((rows) => {
        if (alive) setSports(rows);
      })
      .catch((e) => {
        if (alive) setError(getErrorMessage(e, 'Could not load the sports list.'));
      });
    return () => {
      alive = false;
    };
  }, []);

  // The scorekeeper picker. Fetched per campfire rather than once, because the answer changes with
  // the campfire and a stale roster would offer somebody the server will refuse.
  const circleId = circle?.id;
  useEffect(() => {
    if (!circleId) return;
    let alive = true;
    fetchCampfireMembers(circleId)
      .then((rows) => {
        if (alive) setMembers({ circleId, rows });
      })
      .catch(() => {
        // Non-fatal: with no list the form falls back to "you", which is the default anyway.
        if (alive) setMembers({ circleId, rows: [] });
      });
    return () => {
      alive = false;
    };
  }, [circleId]);

  const sport = useMemo(() => sports?.find((s) => s.key === sportKey) ?? null, [sports, sportKey]);
  const isCustom = sportKey === 'custom';
  const notAdmin = Boolean(circle) && circle.role !== 'owner' && circle.role !== 'admin';
  const namesOk =
    teamAName.trim().length > 0 &&
    teamBName.trim().length > 0 &&
    teamAName.trim().toLowerCase() !== teamBName.trim().toLowerCase();
  const canPost = Boolean(circle) && !notAdmin && namesOk && (!isCustom || customSport.trim().length > 0);

  const refName =
    refUserId === null || refUserId === myUserId
      ? 'you'
      : (roster?.find((m) => m.user_id === refUserId)?.display_name ?? 'them');

  async function post() {
    if (!circle) return;
    setSaving(true);
    setError(null);
    try {
      const res = await createTeamMatch({
        circleId: circle.id,
        sportKey,
        customSportLabel: isCustom ? customSport.trim() : null,
        teamAName: teamAName.trim(),
        teamBName: teamBName.trim(),
        teamAColor,
        teamBColor,
        refUserId,
        scoreMode,
        winnerTier,
        loserTier,
      });
      // Straight to the match, not back to the form: the next thing anyone wants is to pick a
      // side, and the card is already in the chat behind us.
      router.replace(`/challenge/match/${res.challenge_id}`);
    } catch (e) {
      setError(getErrorMessage(e, "That didn't go through."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Team match', headerBackTitle: 'Back' }} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.banner}>
          <Ionicons name="people" size={16} color={Colors.achieverText} />
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle}>Two teams, one scorekeeper</Text>
            <Text style={styles.bannerSub}>
              Everyone who plays earns something — the winning side just earns more. No individual
              stats.
            </Text>
          </View>
        </View>

        {/* ── which campfire ── */}
        <Text style={styles.label}>Which campfire?</Text>
        {groups.length === 0 ? (
          <Text style={styles.hint}>Join or start a Campfire first — a match belongs to one.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {groups.map((g, i) => (
              <Pressable
                key={g.id}
                onPress={() => setPickedCircle(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: i === circleIndex }}
                style={[styles.circleChip, i === circleIndex && styles.chipSelected]}>
                <Text style={styles.circleEmoji}>{g.emoji}</Text>
                <Text style={[styles.chipText, i === circleIndex && styles.chipTextSelected]}>{g.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {notAdmin && (
          <View style={styles.adminNotice}>
            <Ionicons name="lock-closed" size={13} color={Colors.muted} />
            <Text style={styles.adminNoticeText}>
              Only admins can post a match for {circle?.name ?? 'a campfire'}. Ask an owner to make
              you one.
            </Text>
          </View>
        )}

        {/* ── the sport ── */}
        <Text style={styles.label}>Pick the game</Text>
        {sports === null ? (
          <ActivityIndicator color={Colors.amber} style={styles.loader} />
        ) : (
          <View style={styles.sportGrid}>
            {sports.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => setSportKey(s.key)}
                accessibilityRole="button"
                accessibilityLabel={s.label}
                accessibilityState={{ selected: s.key === sportKey }}
                style={[styles.sportTile, s.key === sportKey && styles.sportTileOn]}>
                <Text style={styles.sportEmoji}>{s.emoji}</Text>
                <Text style={styles.sportName} numberOfLines={1}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {isCustom && (
          <TextInput
            value={customSport}
            onChangeText={setCustomSport}
            placeholder="What are you playing?"
            maxLength={24}
          />
        )}
        {/* The scorekeeper's buttons come from the catalog, so this is worth saying up front: it
            is why basketball gets three buttons and soccer gets one. */}
        {sport && !isCustom && <Text style={styles.hint}>Scores step by {sport.score_step_label.replace('+', '')}.</Text>}

        {/* ── the teams ── */}
        <Text style={styles.label}>The teams</Text>
        <TeamRow
          name={teamAName}
          onName={setTeamAName}
          color={teamAColor}
          onColor={setTeamAColor}
          otherColor={teamBColor}
        />
        <TeamRow
          name={teamBName}
          onName={setTeamBName}
          color={teamBColor}
          onColor={setTeamBColor}
          otherColor={teamAColor}
        />
        {!namesOk && teamAName.trim() && teamBName.trim() && (
          <Text style={styles.warn}>The two teams need different names.</Text>
        )}

        {/* ── how the score gets kept (§1b — the load-bearing choice) ── */}
        <Text style={styles.label}>How is the score kept?</Text>
        <ModeRow
          selected={scoreMode === 'confirm'}
          onPress={() => setScoreMode('confirm')}
          icon="checkmark-done"
          title="Final score, both sides confirm"
          sub="For real games. Nobody tracks anything live — afterwards one player enters the final score and someone on the other team confirms it."
        />
        <ModeRow
          selected={scoreMode === 'live'}
          onPress={() => setScoreMode('live')}
          icon="stopwatch"
          title="Live scoreboard"
          sub="For pickup games with no official board. One scorekeeper taps the score in as it happens and the whole campfire watches it tick."
        />

        {/* ── the scorekeeper ── */}
        <Text style={styles.label}>Who keeps score?</Text>
        <Text style={styles.hint}>
          {scoreMode === 'live'
            ? 'Only this person can move the score. It can be anyone — a captain, a spectator, a player.'
            : 'They can settle the match if the two sides disagree. Not required to do anything otherwise.'}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Pressable
            onPress={() => setRefUserId(null)}
            accessibilityRole="button"
            accessibilityState={{ selected: refUserId === null }}
            style={[styles.circleChip, refUserId === null && styles.chipSelected]}>
            <Text style={[styles.chipText, refUserId === null && styles.chipTextSelected]}>You</Text>
          </Pressable>
          {(roster ?? [])
            .filter((m) => m.user_id !== myUserId)
            .map((m) => (
              <Pressable
                key={m.user_id}
                onPress={() => setRefUserId(m.user_id)}
                accessibilityRole="button"
                accessibilityState={{ selected: refUserId === m.user_id }}
                style={[styles.circleChip, refUserId === m.user_id && styles.chipSelected]}>
                <Text style={[styles.chipText, refUserId === m.user_id && styles.chipTextSelected]}>
                  {m.display_name}
                </Text>
              </Pressable>
            ))}
        </ScrollView>

        {/* ── the reward ── */}
        <Text style={styles.label}>What it pays</Text>
        <Text style={styles.hint}>
          Every player on the winning side gets the same crate; every player on the losing side gets
          the one below. A draw pays both sides the winners&apos; tier.
        </Text>
        <View style={styles.chipRow}>
          {TIER_LADDER.slice(0, 4).map((t) => (
            <Pressable
              key={t}
              onPress={() => setLoserTier(t)}
              accessibilityRole="button"
              accessibilityState={{ selected: t === loserTier }}
              style={[styles.circleChip, t === loserTier && styles.chipSelected]}>
              <Text style={[styles.chipText, t === loserTier && styles.chipTextSelected]}>{TIER_LABEL[t]}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.rewardLine}>
          <View style={styles.rewardChip}>
            <Ionicons name="trophy" size={12} color={Colors.green} />
            <Text style={[styles.rewardChipText, { color: Colors.green }]}>
              Winners: {TIER_LABEL[winnerTier]}
            </Text>
          </View>
          <View style={styles.rewardChip}>
            <Ionicons name="hand-left" size={12} color={Colors.sky} />
            <Text style={[styles.rewardChipText, { color: Colors.sky }]}>Losers: {TIER_LABEL[loserTier]}</Text>
          </View>
        </View>

        <Text style={styles.footnote}>
          {sport?.emoji ?? ''} {isCustom ? customSport.trim() || 'Custom' : (sport?.label ?? '')} ·{' '}
          {teamAName.trim() || 'Team A'} vs {teamBName.trim() || 'Team B'} · {refName} keeping score
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton
          label={notAdmin ? `Only ${circle?.name ?? 'campfire'} admins can` : 'Post to campfire'}
          onPress={post}
          loading={saving}
          disabled={!canPost}
        />
      </View>
    </Screen>
  );
}

/** One team's row: a colour dot that cycles, and its name. Extracted because there are two of them
 *  and the only difference is which state they hold — the exact case a second copy goes stale. */
function TeamRow({
  name,
  onName,
  color,
  onColor,
  otherColor,
}: {
  name: string;
  onName: (v: string) => void;
  color: string;
  onColor: (v: string) => void;
  /** The other side's colour, so tapping through never lands both teams on the same kit — which
   *  would make the live card unreadable at exactly the moment it matters. */
  otherColor: string;
}) {
  const cycle = () => {
    const i = TEAM_COLORS.indexOf(color as (typeof TEAM_COLORS)[number]);
    for (let step = 1; step <= TEAM_COLORS.length; step += 1) {
      const next = TEAM_COLORS[(i + step) % TEAM_COLORS.length];
      if (next !== otherColor) {
        onColor(next);
        return;
      }
    }
  };

  return (
    <View style={styles.teamRow}>
      <Pressable
        onPress={cycle}
        accessibilityRole="button"
        accessibilityLabel="Change this team's colour"
        hitSlop={8}
        style={[styles.colorDot, { backgroundColor: color }]}
      />
      <TextInput
        value={name}
        onChangeText={onName}
        placeholder="Team name"
        maxLength={24}
        style={styles.teamNameInput}
      />
    </View>
  );
}

function ModeRow({
  selected,
  onPress,
  icon,
  title,
  sub,
}: {
  selected: boolean;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.modeRow, selected && styles.modeRowOn]}>
      <Ionicons name={icon} size={17} color={selected ? Colors.achieverText : Colors.muted} />
      <View style={styles.modeText}>
        <Text style={[styles.modeTitle, selected && styles.modeTitleOn]}>{title}</Text>
        <Text style={styles.modeSub}>{sub}</Text>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={17}
        color={selected ? Colors.achieverText : Colors.textTertiary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: Spacing.five, gap: Spacing.two },
  loader: { alignSelf: 'flex-start', marginVertical: Spacing.two },
  banner: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.3)',
    borderRadius: Radius.card,
    padding: Spacing.twelve,
    marginTop: Spacing.two,
  },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontFamily: Fonts.bodyBold, fontSize: 13.5, color: Colors.ink },
  bannerSub: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted, lineHeight: 16 },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginTop: Spacing.twelve,
  },
  hint: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted, lineHeight: 16 },
  warn: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.danger },
  error: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginBottom: Spacing.two },
  chipRow: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one, flexWrap: 'wrap' },
  circleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  chipSelected: { backgroundColor: Colors.selectedBg, borderColor: Colors.amber },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.muted },
  chipTextSelected: { color: Colors.ink },
  circleEmoji: { fontSize: 13 },
  adminNotice: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    padding: Spacing.twelve,
  },
  adminNoticeText: { flex: 1, fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted, lineHeight: 16 },
  sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sportTile: {
    width: 66,
    alignItems: 'center',
    gap: 3,
    paddingVertical: Spacing.two,
    borderRadius: Radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  sportTileOn: { borderColor: Colors.amber, backgroundColor: Colors.selectedBg },
  sportEmoji: { fontSize: 20 },
  sportName: { fontFamily: Fonts.bodySemiBold, fontSize: 9.5, color: Colors.muted },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  colorDot: { width: 22, height: 22, borderRadius: 11 },
  teamNameInput: { flex: 1 },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.twelve,
    borderRadius: Radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  modeRowOn: { borderColor: Colors.amber, backgroundColor: Colors.selectedBg },
  modeText: { flex: 1, gap: 2 },
  modeTitle: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.muted },
  modeTitleOn: { color: Colors.ink },
  modeSub: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textTertiary, lineHeight: 15 },
  rewardLine: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center', marginTop: Spacing.two },
  rewardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  rewardChipText: { fontFamily: Fonts.bodyBold, fontSize: 11.5 },
  footnote: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.twelve,
  },
  footer: { paddingVertical: Spacing.twelve },
});
