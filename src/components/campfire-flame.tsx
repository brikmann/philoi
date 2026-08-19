
import { HeatFlame } from '@/components/heat-flame';

type CampfireFlameProps = {
  /** 0 (dormant, nearly out) to 1 (roaring — everyone locked in today) — see get_my_campfire_heat() in schema.sql. */
  heat: number;
  size?: number;
};

// The living-flame signature mechanic (UI_REDESIGN_SPEC.md) — a Campfire's flame is a live
// gauge of the GROUP's activity, distinct from LockInFlame (an individual session's timer-
// driven flame). Same breathing/glow visual language, smaller scale, driven by a 0-1 heat
// score instead of elapsed seconds.
export function CampfireFlame({ heat, size = 32 }: CampfireFlameProps) {
  // The heat gauge (punchlist 17 P5), not the brand mark. P0 swapped the 🔥 emoji for FlameSvg as a
  // stopgap; this is the real thing — a coal-bed fire whose composition changes with the group's
  // heat, so a dying campfire looks dead rather than just dim. Heat is get_my_campfire_heat()'s
  // share-of-members-locked-in-today, already 0-1.
  return <HeatFlame heat={heat} size={size} />;
}

