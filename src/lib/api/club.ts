import { supabase } from '@/lib/supabase';

/**
 * THE CLUB PAGE (Phase 8.2, mock 335, migration 0292) — one room's week, and its standings switch.
 *
 * A "club" is a campfire (groups) or a forest. Both carry `standings_enabled`, false by default:
 * off, the room shows no leaderboard and no rank anywhere and says so ("Leaderboard off — this club's
 * choice"); a club admin can turn it on, which only opens the standings view INSIDE the club.
 *
 * The collective is Phase 3's counting scoped to one room — lock-in hours this week across every
 * member, you included, counted once. No per-member breakdown.
 */
export type RoomKind = 'campfire' | 'forest';

export type RoomWeek = {
  isMember: boolean;
  standingsEnabled: boolean;
  /** Null for a visitor — the hours are members-only; the badge is not. */
  thisWeekSeconds: number | null;
  lastWeekToDateSeconds: number | null;
  members: number | null;
};

type RoomWeekRow = {
  out_is_member: boolean;
  out_standings_enabled: boolean;
  out_this_week_seconds: number | string | null;
  out_last_week_to_date_secs: number | string | null;
  out_members: number | null;
};

/** Null when the room isn't visible to you, or on a server without 0292 (the block isn't drawn). */
export async function fetchRoomWeek(kind: RoomKind, id: string): Promise<RoomWeek | null> {
  const { data, error } = await supabase.rpc('get_group_week_hours', { p_group_id: id, p_kind: kind });
  if (error) {
    if (error.code === 'PGRST202') return null;
    throw error;
  }
  const r = ((data ?? []) as RoomWeekRow[])[0];
  if (!r) return null;
  const num = (v: number | string | null) => (v == null ? null : Number(v));
  return {
    isMember: r.out_is_member,
    standingsEnabled: Boolean(r.out_standings_enabled),
    thisWeekSeconds: num(r.out_this_week_seconds),
    lastWeekToDateSeconds: num(r.out_last_week_to_date_secs),
    members: r.out_members,
  };
}

/** A campfire admin's / forest owner's switch. The server refuses anyone else (42501). */
export async function setRoomStandings(kind: RoomKind, id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_room_standings', { p_kind: kind, p_id: id, p_enabled: enabled });
  if (error) throw error;
}
