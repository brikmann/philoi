import type { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { getItem } from '@/lib/economy/catalog';
import { SEASON, levelFromXp } from '@/lib/economy/forge-pass';
import { RARITY_COLOR, RARITY_LABEL, type Rarity } from '@/lib/economy/rarity';
import { formatDistanceKm, formatSessionDuration } from '@/lib/format';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
import { RANK_TIER_METAL, formatRankTier } from '@/lib/rank-tiers';
import type {
  AgoraAttachKind,
  AgoraAttachSnapshot,
  AgoraAttachment,
  AgoraItem,
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
};

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
      };
    }

    case 'lockin': {
      const goal = (snap.goal_type ?? 'custom') as GoalType;
      const meta = GOAL_TYPE_META[goal] ?? GOAL_TYPE_META.custom;
      const bits: string[] = [];
      if (snap.duration_seconds) bits.push(formatSessionDuration(snap.duration_seconds));
      if (snap.distance_m) bits.push(formatDistanceKm(snap.distance_m));
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
