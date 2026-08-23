import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { CindyFlamePress } from '@/components/cindy/cindy-flame-press';
import { EquippedFlameSvg } from '@/components/flame-icon';
import { useCindy } from '@/hooks/use-cindy';

// Cindy, reachable from anywhere (CINDY_SPEC, mock 117 "Global").
//
// A small flame in the header's right slot on every non-home screen. NOT a floating action button:
// a FAB hovers over content and fights the ember minimalism, and more to the point a round button
// with a flame inside it is a chatbot launcher wearing her costume. The flame itself is the entry
// point, the same as on home.
//
// Home deliberately has none — it does not use TabHeader, because its hero flame already IS this.
//
// Same CindyFlamePress as home, so tap/hold and the ring pulse behave identically wherever she
// appears; the spec asks for one press state, not a per-surface imitation of it.

const SIZE = 20;

export function CindyHeaderFlame() {
  const router = useRouter();
  const { consented } = useCindy();

  // Nothing to reach before consent. Home disables its flame rather than hiding it because the
  // flame is the screen's centrepiece either way; a dead 20px glyph in a header is just a puzzle.
  if (!consented) return null;

  return (
    <View style={styles.wrap}>
      <CindyFlamePress
        size={SIZE}
        onTap={() => router.push('/cindy')}
        onHold={() => router.push('/cindy-voice')}>
        <EquippedFlameSvg width={SIZE * 0.82} height={SIZE} />
      </CindyFlamePress>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // The rings expand past the flame; without room they clip against the header edge.
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
