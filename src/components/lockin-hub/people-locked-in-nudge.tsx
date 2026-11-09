import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors, Fonts } from '@/constants/theme';
import { fetchPeopleActiveNow } from '@/lib/api/home';

/** How often the count is re-read mid-session. The server's own tick is 30s; a minute is plenty for a glance. */
const POLL_MS = 60_000;

/**
 * Mock 359's social nudge — "🔥 12 of your people are locked in now" — under the timer.
 *
 * YOUR people (friends, campfire- and room-mates; get_people_active_now, 0290), not everyone on the
 * app: being accompanied by people you know is the point. When none of them are live (or you've
 * hidden your own live status, which hides theirs from you — it's reciprocal) it draws `fallback`
 * instead: the app-wide "N studying right now" pill, so a quiet night still feels inhabited.
 *
 * Polls only while `active` (not paused, not stopping); a failed read keeps the last count.
 */
export function PeopleLockedInNudge({ active, fallback }: { active: boolean; fallback?: ReactNode }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = () =>
      fetchPeopleActiveNow()
        .then((n) => {
          if (live) setCount(n && !n.youHidden ? n.count : 0);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [active]);

  if (!active || count <= 0) return <>{fallback ?? null}</>;
  return (
    <View style={styles.pill} accessibilityRole="text">
      <NavGlyph name="flame" size={14} color={Colors.navEmber} />
      <Text style={styles.text}>
        {count === 1 ? '1 of your people is locked in now' : `${count.toLocaleString('en-US')} of your people are locked in now`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(255,122,47,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,122,47,0.30)',
  },
  text: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
});
