import type { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { getItem } from '@/lib/economy/catalog';
import { SEASON, levelFromXp } from '@/lib/economy/forge-pass';
import { RARITY_COLOR, RARITY_LABEL, type Rarity } from '@/lib/economy/rarity';
import { formatDistanceKm, formatSessionDuration, pluralize } from '@/lib/format';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
import { RANK_TIER_METAL, formatRankTier } from '@/lib/rank-tiers';
import type {
  AgoraAttachKind,
  AgoraAttachSnapshot,
  AgoraAttachment,
  AgoraClipEntry,
  AgoraItem,
  AgoraLiftEntry,
  GoalType,
  RankTierName,
} from '@/types/database';

// ONE place that turns a frozen attachment into words and a colour.
//
// The composer's picker rows and the posted card render through this same function, on purpose:
// they are showing the same achievement, and two formatters would eventually disagree about what
// a thing is called between the sheet you picked it in and the card everyone else sees.
//
// The server froze FACTS (rank_index, pass_xp, cosmetic_key — see migration 0130's note); the
// names live here, next to the catalog and the tier table that already own them. That split is
// what keeps a stale card honest — "Hero II" is re-derived from a rank_index that will not move —
// without duplicating the app's entire display vocabulary into SQL.

export type AgoraAttachmentView = {
  title: string;
  subtitle: string | null;
  /** Small all-caps line above the subtitle — rarity, mostly. Null when there is nothing to say. */
  eyebrow: string | null;
  eyebrowColor: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** The tile behind the icon. Tuned per kind so a Mythic relic doesn't look like a lock-in. */
  tint: string;
  /** Where tapping the card should land (spec: "Feed item routes to the underlying thing"). */
  route: { pathname: string; params?: Record<string, string> } | null;
  /**
   * The lift, when the attachment is a gym session. Null for every other kind AND for a gym
   * session posted before migration 0192 froze any of this — an old post keeps rendering as the
   * bare title/subtitle row it has always been rather than growing an empty section.
   */
  lift: AgoraLiftView | null;
};

/**
 * A posted workout, ready to draw.
 *
 * The Agora is a flex feed and a lift is the flex, so a gym post that says "38:04" and nothing
 * else is the session with its content removed. 0192 started freezing the sets, the volume, the
 * PRs and the kept clips into the snapshot; this is the shape that carries them from there to the
 * card.
 *
 * Two counts per list, deliberately. `sets`/`clips` are what the snapshot kept (12 and 6), while
 * `exerciseCount`/`clipCount` are what the session actually had — so "+4 more" is the truth about
 * a long session rather than a cap pretending to be a total.
 */
export type AgoraLiftView = {
  sets: AgoraLiftEntry[];
  exerciseCount: number;
  totalSets: number;
  /** Pounds. 0 for a bodyweight-only session, which is why `hasVolume` exists beside it. */
  totalVolume: number;
  hasVolume: boolean;
  hasPr: boolean;
  clips: AgoraClipEntry[];
  clipCount: number;
};

/** "12,400 lb" — the one number a lifter scans a card for. */
export function formatVolume(pounds: number): string {
  return `${Math.round(pounds).toLocaleString('en-US')} lb`;
}

/**
 * The strength half of a lockin snapshot, or null when there isn't one.
 *
 * Every field is re-checked rather than trusted, because this snapshot is frozen jsonb of whatever
 * shape the server wrote on the day of the post: a pre-0192 gym post has none of these keys, and a
 * cardio post never will. Null here is what keeps both of those rendering exactly as before.
 */
function liftView(snap: AgoraAttachSnapshot): AgoraLiftView | null {
  const sets = Array.isArray(snap.sets) ? snap.sets : [];
  const clips = Array.isArray(snap.clips) ? snap.clips : [];
  const totalSets = snap.total_sets ?? 0;
  const exerciseCount = snap.exercise_count ?? sets.length;
  if (sets.length === 0 && totalSets === 0 && clips.length === 0) return null;

  const totalVolume = snap.total_volume ?? 0;
  return {
    sets,
    exerciseCount,
    totalSets,
    totalVolume,
    // A bodyweight session genuinely moved no bar, and "0 lb" reads as a bug rather than as
    // dips-and-pull-ups. The set list still carries what was done.
    hasVolume: totalVolume > 0,
    hasPr: snap.has_pr === true,
    clips,
    clipCount: snap.clip_count ?? clips.length,
  };
}

const KIND_LABEL: Record<string, string> = {
  grade: 'Grade',
  offer: 'Offer',
  certification: 'Certification',
  fitness_pr: 'Fitness PR',
  project: 'Project',
  custom: 'Milestone',
};

/** "23h · 🔥 14-day streak" — the milestone receipts, compacted onto one line for a feed card. */
function effortLine(effort: AgoraAttachSnapshot['effort']): string | null {
  if (!effort) return null;
  const parts: string[] = [];
  if (effort.hours !== undefined) parts.push(`${effort.hours}h locked in`);
  if (effort.streak !== undefined) parts.push(`🔥 ${effort.streak}-day streak`);
  if (effort.lockins !== undefined) parts.push(`${effort.lockins} lock-ins`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function attachmentView(
  kind: AgoraAttachKind | null,
  snap: AgoraAttachSnapshot | null | undefined
): AgoraAttachmentView | null {
  if (!kind || !snap) return null;

  switch (kind) {
    case 'milestone': {
      const label = KIND_LABEL[snap.kind ?? 'custom'] ?? 'Milestone';
      return {
        title: snap.headline ?? 'A milestone',
        // The receipts, not the note. The note is already the card's body text when a milestone
        // surfaces on its own, and repeating it under the headline just doubles it.
        subtitle: effortLine(snap.effort),
        eyebrow: label.toUpperCase(),
        eyebrowColor: Colors.ember,
        icon: 'school-outline',
        tint: Colors.plum,
        route: snap.milestone_id
          ? { pathname: '/milestone/[id]', params: { id: snap.milestone_id } }
          : null,
        lift: null,
      };
    }

    case 'lockin': {
      const goal = (snap.goal_type ?? 'custom') as GoalType;
      const meta = GOAL_TYPE_META[goal] ?? GOAL_TYPE_META.custom;
      const lift = liftView(snap);
      const bits: string[] = [];
      if (snap.duration_seconds) bits.push(formatSessionDuration(snap.duration_seconds));
      if (snap.distance_m) bits.push(formatDistanceKm(snap.distance_m));
      // THE HEADLINE OF A LIFT IS THE LOAD, NOT THE CLOCK. A gym post used to read "38:04" and
      // stop, which is the one fact about a workout that says least about it. Volume goes on the
      // summary line next to the duration; the per-exercise breakdown is the card's own section.
      if (lift?.hasVolume) bits.push(formatVolume(lift.totalVolume));
      if (lift && lift.totalSets > 0) bits.push(`${lift.totalSets} ${pluralize(lift.totalSets, 'set')}`);
      return {
        title: snap.goal_label?.trim() || meta.label,
        subtitle: bits.join(' · ') || null,
        eyebrow: 'LOCK-IN',
        eyebrowColor: Colors.amber,
        icon: GOAL_TYPE_ICON[goal] ?? 'lock-closed-outline',
        tint: Colors.cardDark,
        route: snap.check_in_id
          ? { pathname: '/activity/[checkInId]', params: { checkInId: snap.check_in_id } }
          : null,
        lift,
      };
    }

    case 'rank': {
      const tier = snap.tier as RankTierName | undefined;
      const metal = tier ? RANK_TIER_METAL[tier] : undefined;
      return {
        title: tier ? formatRankTier(tier, snap.division ?? 1) : 'Ranked up',
        subtitle: 'Global rank · career-long, never resets',
        eyebrow: 'STANDING',
        eyebrowColor: metal?.text ?? Colors.muted,
        icon: 'trophy-outline',
        tint: metal?.outer ?? Colors.plum,
        route: { pathname: '/(tabs)/leaderboards' },
        lift: null,
      };
    }

    case 'streak': {
      const days = snap.days ?? 0;
      return {
        title: `${days}-day streak 🔥`,
        subtitle:
          snap.longest && snap.longest > days ? `Personal best: ${snap.longest} days` : 'No dead days',
        eyebrow: 'STANDING',
        eyebrowColor: Colors.amber,
        icon: 'flame-outline',
        tint: Colors.achieverBg,
        route: null,
        lift: null,
      };
    }

    case 'pass': {
      // The curve lives in forge-pass.ts; the server froze the raw XP so this stays one definition.
      const { level } = levelFromXp(snap.pass_xp ?? 0);
      return {
        title: `Flame Pass · Level ${level}`,
        subtitle: `${SEASON.name} season`,
        eyebrow: 'STANDING',
        eyebrowColor: Colors.ember,
        icon: 'shield-checkmark-outline',
        tint: Colors.plum,
        route: { pathname: '/forge-pass' },
        lift: null,
      };
    }

    case 'cosmetic': {
      const item = snap.cosmetic_key ? getItem(snap.cosmetic_key) : undefined;
      // rarity_override is the placement-grant escalation (0066) — a Global Top 1% outranks the
      // catalog entry it was minted from, and the card has to say the one the owner actually has.
      const rarity = ((snap.rarity_override as Rarity) ?? item?.rarity ?? 'common') as Rarity;
      return {
        title: item?.name ?? snap.cosmetic_key ?? 'A collectible',
        subtitle: snap.season_stamp ?? snap.provenance ?? item?.lore ?? null,
        eyebrow: `${RARITY_LABEL[rarity] ?? rarity} ${item?.type ?? 'item'}`.toUpperCase(),
        eyebrowColor: RARITY_COLOR[rarity] ?? Colors.muted,
        icon: 'diamond-outline',
        tint: item?.art.from ?? Colors.plum,
        route: snap.cosmetic_key
          ? { pathname: '/inventory/[itemId]', params: { itemId: snap.cosmetic_key } }
          : null,
        lift: null,
      };
    }

    case 'pr': {
      const weight = snap.weight ? `${Math.round(snap.weight)} lb` : null;
      const reps = snap.reps ? `× ${snap.reps}` : null;
      return {
        title: snap.exercise ? `${snap.exercise} PR` : 'Personal record',
        subtitle: [weight, reps].filter(Boolean).join(' ') || null,
        eyebrow: 'PERSONAL BEST',
        eyebrowColor: Colors.green,
        icon: 'barbell-outline',
        tint: Colors.cardDark,
        route: null,
        lift: null,
      };
    }

    default:
      return null;
  }
}

/**
 * The order attachments are DRAWN in, which is not the order they were composed in.
 *
 * Mock 162 lets a post carry a photo, a lock-in and an achievement at once, and the composer has
 * no meaningful sequence to offer — you tap the three buttons in whatever order you think of them.
 * Pinning the render order here means the same three attachments look the same on every card, and
 * that a reader learns where to find the lock-in on a card instead of re-scanning each one.
 *
 * Lock-in first: it is the thing that just happened, and the achievement is the standing it moved.
 */
const ATTACH_ORDER: AgoraAttachKind[] = [
  'lockin',
  'milestone',
  'rank',
  'streak',
  'pass',
  'cosmetic',
  'pr',
];

function attachRank(kind: AgoraAttachKind): number {
  const i = ATTACH_ORDER.indexOf(kind);
  return i < 0 ? ATTACH_ORDER.length : i;
}

/**
 * Every attachment on a feed item, ordered — the ONE list every renderer walks.
 *
 * Falls back to the 0128 single-attachment pair when `attachments` is missing or empty. Migration
 * 0140 backfilled the array and the feed query normalises on read, so that branch should never
 * fire against a current server; it exists because the alternative failure is a post rendering as
 * though it had no attachment at all, which is indistinguishable from the bug this all replaced.
 */
export function itemAttachments(
  item: Pick<AgoraItem, 'attach_kind' | 'attach_snapshot' | 'attachments'>
): AgoraAttachment[] {
  const raw: AgoraAttachment[] =
    Array.isArray(item.attachments) && item.attachments.length > 0
      ? item.attachments
      : item.attach_kind
        ? [
            {
              kind: item.attach_kind,
              ref_id: null,
              key: null,
              snapshot: item.attach_snapshot ?? {},
            },
          ]
        : [];

  return raw
    .filter((a) => Boolean(a?.kind))
    .sort((a, b) => attachRank(a.kind) - attachRank(b.kind));
}

/** A stable React key for one attachment. Kind is unique per post, so it alone would do. */
export function attachmentKey(a: AgoraAttachment): string {
  return `${a.kind}:${a.ref_id ?? a.key ?? ''}`;
}

/** The picker's section headers, in the order mock 162 panel 4 lists them. */
export const ACHIEVEMENT_SECTIONS: { key: string; label: string }[] = [
  { key: 'standing', label: 'Standing' },
  { key: 'collectibles', label: 'Collectibles' },
  { key: 'milestones', label: 'Grades & milestones' },
  { key: 'fitness', label: 'Fitness' },
];

/** Mock 162's filter chips over that list. 'all' first, then one per section. */
export const ACHIEVEMENT_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'standing', label: 'Standing' },
  { key: 'collectibles', label: 'Collectibles' },
  { key: 'milestones', label: 'Grades' },
  { key: 'fitness', label: 'Fitness' },
];
