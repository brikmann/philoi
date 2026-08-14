import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { useAudioPreview } from '@/hooks/use-audio-preview';
import type { CatalogItem } from '@/lib/economy/catalog';
import { hasPreview } from '@/lib/sound';

// "Hear it before you buy it" (PUNCHLIST_11). Renders nothing for items with no preview, so every
// call site can drop it in unconditionally instead of repeating the AUDIO/SFX type check — an item
// is auditionable exactly when a clip exists for it, which is a stronger test than its type tag.

type Props = {
  item: Pick<CatalogItem, 'id' | 'name'>;
  /** `full` for detail screens, `badge` for the corner of a tile. */
  variant?: 'full' | 'badge';
};

export function PreviewButton({ item, variant = 'full' }: Props) {
  const { playingId, toggle } = useAudioPreview();
  if (!hasPreview(item.id)) return null;

  const playing = playingId === item.id;
  const label = playing ? `Stop previewing ${item.name}` : `Preview ${item.name}`;

  if (variant === 'badge') {
    return (
      <Pressable
        style={[styles.badge, playing && styles.badgeOn]}
        onPress={() => toggle(item.id)}
        // Tiles are small and the badge sits in a corner; without this the tap target would be
        // well under the 44pt minimum and would mostly hit the tile's own navigation instead.
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={label}>
        <Ionicons name={playing ? 'stop' : 'play'} size={9} color={playing ? '#2a1608' : Colors.ink} />
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.full, playing && styles.fullOn]}
      onPress={() => toggle(item.id)}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Ionicons name={playing ? 'stop' : 'play'} size={13} color={playing ? '#2a1608' : Colors.ember} />
      <Text style={[styles.fullText, playing && styles.fullTextOn]}>{playing ? 'Stop' : 'Preview'}</Text>
    </Pressable>
  );
}

/** The badge, absolutely positioned for a tile corner. Kept here so tiles don't each re-derive it. */
export function PreviewBadgeCorner({ item }: { item: Pick<CatalogItem, 'id' | 'name'> }) {
  if (!hasPreview(item.id)) return null;
  return (
    <View style={styles.corner}>
      <PreviewButton item={item} variant="badge" />
    </View>
  );
}

const styles = StyleSheet.create({
  full: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  fullOn: {
    backgroundColor: Colors.ember,
  },
  fullText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ember,
  },
  fullTextOn: {
    color: '#2a1608',
  },
  badge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOn: {
    backgroundColor: Colors.ember,
  },
  corner: {
    position: 'absolute',
    top: 5,
    right: 5,
    zIndex: 1,
  },
});
