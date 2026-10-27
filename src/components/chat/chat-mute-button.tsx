import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { SpaceIconButton } from '@/components/ui/space-kit';
import { Colors } from '@/constants/theme';

// THE ROOM'S MUTE BELL (0284 · chat_set_muted) — a DM's and a forest room's header, and the dim
// mark on a muted Chats row.
//
// The icon set has a bell and no bell-off, so "muted" is the same bell, dimmed, with a bar struck
// through it. Drawn here once so the header and the list can't grow two different ideas of what a
// muted room looks like.

/** The bell, struck through and dimmed when the room is muted. */
export function MuteBell({ muted, size, color }: { muted: boolean; size: number; color: string }) {
  return (
    <View style={{ width: size, height: size }}>
      <Icon name="bell" size={size} color={muted ? Colors.spaceFaint : color} />
      {muted ? (
        <View
          pointerEvents="none"
          style={[
            styles.strike,
            { width: size * 1.15, left: -size * 0.075, top: size / 2 - 0.75, backgroundColor: Colors.spaceFaint },
          ]}
        />
      ) : null}
    </View>
  );
}

/**
 * The header button. Takes the toggle's state as is — `muted === null` (still asking, or no 0284)
 * draws nothing, so the bar never shows a switch the server can't flip.
 */
export function ChatMuteButton({ muted, onToggle }: { muted: boolean | null; onToggle: () => void }) {
  if (muted === null) return null;
  return (
    <SpaceIconButton
      onPress={onToggle}
      label={muted ? 'Unmute notifications for this chat' : 'Mute notifications for this chat'}>
      <MuteBell muted={muted} size={18} color={Colors.ink} />
    </SpaceIconButton>
  );
}

const styles = StyleSheet.create({
  strike: {
    position: 'absolute',
    height: 1.5,
    borderRadius: 1,
    transform: [{ rotate: '-45deg' }],
  },
});
