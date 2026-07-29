// Dynamic home greeting (PHILOI_UI_SPEC.md §5) — driven by today's lock-in count (resets
// local midnight) x time of day. Pure functions so the picking logic is easy to reason about
// independent of the component that renders it.

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'late';

// Morning 5-11 · Afternoon 11-17 · Evening 17-21 · Late 21-5 (wraps past midnight).
export function timeOfDayBucket(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'late';
}

const FRESH_VARIANTS: Record<TimeOfDay, string[]> = {
  morning: ['Morning, {name} — first lock-in?', "New day, {name}. Let's light it."],
  afternoon: ['Afternoon, {name} — time to lock in.', "Still fresh, {name}. Let's go."],
  evening: ['Evening, {name} — get one in?', 'There\'s still time, {name}.'],
  late: ['One before bed, {name}?', 'Late night, {name} — quick one?'],
};

const COUNT_VARIANTS: Record<number, string[]> = {
  1: ['Nice lock-in, {name}. Want to keep going?', "That's one, {name} — keep the fire going?"],
  2: ['2 down, more to go, {name}.', 'Two in, {name} — rolling now.'],
  3: ["Three's a charm, {name}.", 'Hat trick, {name}.'],
  4: ["You're heating up, {name}.", 'Four deep, {name} — dialed.'],
  5: ["You're on fire today, {name}!", 'Five and blazing, {name}!'],
};

const SIX_PLUS_VARIANTS = ['Unstoppable, {name}.', "The fire's roaring, {name}.", 'Certified machine, {name}.'];

// Late-night wind-down (§5): at high counts (>=5) in the Late bucket, swap in a rest line
// instead of a "keep going" nudge, so the app never pushes someone to grind past midnight.
const LATE_WIND_DOWN = 'Huge day, {name}. Rest up.';

function variantsFor(count: number, timeOfDay: TimeOfDay): string[] {
  if (count === 0) return FRESH_VARIANTS[timeOfDay];
  if (count === 1) {
    const base = COUNT_VARIANTS[1];
    return timeOfDay === 'evening' ? [...base, "Good one, {name}. Night's young."] : base;
  }
  if (count >= 2 && count <= 5) return COUNT_VARIANTS[count];
  return SIX_PLUS_VARIANTS;
}

/** Picks a greeting line, avoiding an immediate repeat of `previousLine` when another option exists. */
export function pickGreeting(count: number, hour: number, name: string, previousLine?: string): string {
  const timeOfDay = timeOfDayBucket(hour);

  if (timeOfDay === 'late' && count >= 5) {
    return LATE_WIND_DOWN.replace('{name}', name);
  }

  const variants = variantsFor(count, timeOfDay);
  let chosen = variants[Math.floor(Math.random() * variants.length)];
  if (variants.length > 1 && chosen.replace('{name}', name) === previousLine) {
    chosen = variants[(variants.indexOf(chosen) + 1) % variants.length];
  }
  return chosen.replace('{name}', name);
}
