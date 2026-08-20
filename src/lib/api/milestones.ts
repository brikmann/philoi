import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  EffortKey,
  Milestone,
  MilestoneDetail,
  MilestoneEffort,
  MilestoneKind,
  MilestoneVisibility,
} from '@/types/database';

// §8 — Milestones.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// 🔒 FIREWALL. A milestone grants ZERO XP, embers or rank. Nothing in this module may call into
// the economy — no grantReward, no ember or rank write, no reward screen. It is a content post.
// Because there is no payout there is no incentive to fake one, which is exactly why self-reported
// grades need no verification. Adding a reward here would force a verification system to exist.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The receipts the composer previews. Same numbers create_milestone will stamp onto the post. */
export async function fetchMyEffort(): Promise<MilestoneEffort> {
  const { data, error } = await supabase.rpc('get_my_milestone_effort');
  if (error) throw error;
  return (data as MilestoneEffort) ?? {};
}

/**
 * Post a milestone.
 *
 * `effortKeys` is which receipts to KEEP, never their values — the server looks those up itself,
 * so trimming works and inflating is not on the wire at all.
 */
export async function createMilestone(input: {
  kind: MilestoneKind;
  headline: string;
  note?: string | null;
  visibility?: MilestoneVisibility;
  effortKeys?: EffortKey[];
  pinned?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_milestone', {
    p_kind: input.kind,
    p_headline: input.headline,
    p_note: input.note ?? null,
    p_visibility: input.visibility ?? 'friends',
    p_effort_keys: input.effortKeys ?? ['hours', 'streak', 'lockins'],
    p_pinned: input.pinned ?? true,
  });
  if (error) throw error;
  track('milestone_posted', {
    kind: input.kind,
    visibility: input.visibility ?? 'friends',
    pinned: input.pinned ?? true,
    receipts: input.effortKeys?.length ?? 3,
  });
  return data as string;
}

export async function fetchMilestones(userId: string, limit = 50): Promise<Milestone[]> {
  const { data, error } = await supabase.rpc('get_milestones', { p_user: userId, p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMilestone(id: string): Promise<MilestoneDetail | null> {
  const { data, error } = await supabase.rpc('get_milestone', { p_id: id });
  if (error) throw error;
  return (data as MilestoneDetail | null) ?? null;
}

/** Cheer someone's milestone. Fires their notification; pays out nothing to either side. */
export async function cheerMilestone(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('cheer_milestone', { p_milestone_id: id });
  if (error) throw error;
  track('milestone_cheered', {});
  return (data as number) ?? 0;
}

export async function deleteMilestone(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_milestone', { p_id: id });
  if (error) throw error;
}

export const MILESTONE_KINDS: { key: MilestoneKind; label: string }[] = [
  { key: 'grade', label: 'Grade' },
  { key: 'offer', label: 'Offer' },
  { key: 'certification', label: 'Certification' },
  { key: 'fitness_pr', label: 'Fitness PR' },
  { key: 'project', label: 'Project' },
  { key: 'custom', label: 'Custom' },
];

export const VISIBILITY_OPTIONS: { key: MilestoneVisibility; label: string }[] = [
  { key: 'friends', label: 'Friends' },
  { key: 'campus', label: 'Campus' },
  { key: 'public', label: 'Public' },
];

/** "23h locked in" · "🔥 14-day streak" · "18 lock-ins" — the receipt chips, in a stable order. */
export function effortChips(effort: MilestoneEffort): { key: EffortKey; label: string }[] {
  const chips: { key: EffortKey; label: string }[] = [];
  if (effort.hours !== undefined) chips.push({ key: 'hours', label: `${effort.hours}h locked in` });
  if (effort.streak !== undefined) chips.push({ key: 'streak', label: `🔥 ${effort.streak}-day streak` });
  if (effort.lockins !== undefined) chips.push({ key: 'lockins', label: `${effort.lockins} lock-ins` });
  return chips;
}
