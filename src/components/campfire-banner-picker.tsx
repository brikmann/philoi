import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CampfireBannerArt } from '@/components/campfire-banner-art';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { setCampfireBanner } from '@/lib/api/groups';
import { DEFAULT_LOADOUT, getItem, type CatalogItem } from '@/lib/economy/catalog';
import { getErrorMessage } from '@/lib/errors';

// THE BANNER-SET AFFORDANCE (mock 164 §3).
//
// The render side of this shipped a while ago: <CampfireBannerArt> paints the campfire header with
// the OWNER's equipped banner, for every member who opens the fire. What never existed was the
// control — the owner had no way to say which banner their fire flies from inside the campfire,
// only by wandering into Inventory and equipping one for unrelated reasons. So the feature was
// invisible: people owned banners, the header drew one, and nothing connected the two.
//
// NO NEW COLUMN, AND THAT IS THE DESIGN, not a shortcut. Mock 164's own caption says it: "The
// banner is their equipped/owned banner cosmetic — the flex is that your group wears your art."
// Equipping here IS setting the campfire's banner, and it sets it for every fire the person owns
// at once. A per-campfire override (one owner, two fires, two banners) would need a
// `groups.banner_item_id` column and is flagged for a later migration — this build has none.

type CampfireBannerPickerProps = {
  visible: boolean;
  onClose: () => void;
  /** Named in the sheet so it is obvious WHICH fire is about to change. */
  campfireName: string;
  /** The fire being restyled. The banner is ITS property now, not the owner's (0134). */
  groupId: string;
  /** What it currently flies. Null = never chosen, which is the base hearth. */
  currentBannerId: string | null;
  /** Refetch the group so the header behind this sheet repaints. Unused in deferred mode. */
  onChanged: () => void | Promise<void>;
  /**
   * DEFERRED MODE (§1). When provided, picking a banner REPORTS the choice and writes nothing —
   * the caller owns the save.
   *
   * Edit campfire needs this: its brief is that the emoji and the banner "save with the rest of
   * the form", and a picker that calls set_campfire_banner on tap would commit half the form
   * while Save changes is still sitting there unpressed. That is worse than a slow save — it makes
   * Cancel a lie.
   *
   * Without it the component behaves exactly as before (writes immediately, then onChanged), which
   * is right for the options sheet where the picker IS the whole interaction.
   */
  onSelect?: (itemId: string) => void;
};

export function CampfireBannerPicker({ visible, onClose, campfireName, groupId, currentBannerId, onChanged, onSelect }: CampfireBannerPickerProps) {
  const insets = useSafeAreaInsets();
  const { owned, loading } = useInventory();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const banners = useMemo<CatalogItem[]>(() => {
    const mine = owned.filter((item) => item.type === 'BANNER');
    // Hearthlight is the banner you fly on day one — it is granted by DEFAULT_LOADOUT rather than
    // owned as a row, so it never appears in `owned` and without this the picker would offer no
    // way back to the plain look once you equipped something else.
    const base = getItem(DEFAULT_LOADOUT.banner ?? '');
    const hasBase = base && mine.some((item) => item.id === base.id);
    return base && !hasBase ? [base, ...mine] : mine;
  }, [owned]);

  const equippedId = currentBannerId ?? DEFAULT_LOADOUT.banner ?? null;

  async function choose(item: CatalogItem) {
    if (busyKey) return;
    // Deferred: hand the choice back and close. No write, no spinner — there is nothing to wait on.
    if (onSelect) {
      onSelect(item.id);
      onClose();
      return;
    }
    setBusyKey(item.id);
    setError(null);
    try {
      // Writes the CAMPFIRE, not the owner's loadout (0134). The old call was equipCosmetic, which
      // is why picking a banner here used to restyle the owner's profile and every other fire they
      // ran — the header read whatever they had equipped.
      await setCampfireBanner(groupId, item.id);
      // The header behind this sheet reads group.banner_item_id, so the group is what has to be
      // re-read. No route change happens (this is a modal over the campfire screen), and nothing
      // else invalidates it.
      await onChanged();
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not set that banner — try again.'));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grab} />

          <Text style={styles.title}>Choose a banner</Text>
          <Text style={styles.sub}>
            {campfireName} flies your banner. Only the owner sets this — the flex is that your group wears your art.
          </Text>

          {error && <Text style={styles.error}>{error}</Text>}

          {loading && banners.length === 0 ? (
            <ActivityIndicator color={Colors.amber} style={styles.loading} />
          ) : banners.length === 0 ? (
            <Text style={styles.empty}>
              You don&apos;t own a banner yet. They come out of boxes and the Flame Pass — until then your fire flies
              Hearthlight.
            </Text>
          ) : (
            <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
              {banners.map((item) => {
                const on = item.id === equippedId;
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.tile, on && styles.tileOn]}
                    onPress={() => choose(item)}
                    disabled={busyKey !== null}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={item.name}>
                    <View style={styles.swatch}>
                      {/* The real scene, at tile size — a flat two-colour chip would let someone
                          pick a banner whose art they have never seen, and since 101c the banners
                          differ by SCENE rather than by hue that would now be no preview at all.
                          Scenery only: 'header' never runs particles, so a grid of these costs
                          nothing to leave open. */}
                      <CampfireBannerArt itemKey={item.id} fadeTo="#161022" />
                      {busyKey === item.id && (
                        <View style={styles.swatchBusy}>
                          <ActivityIndicator color={Colors.ink} size="small" />
                        </View>
                      )}
                    </View>
                    <View style={styles.tileFoot}>
                      <Text style={[styles.tileName, on && styles.tileNameOn]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {on && <Ionicons name="checkmark-circle" size={14} color={Colors.amber} />}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,10,0.55)',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: '#161022',
    borderTopWidth: 1,
    borderTopColor: '#2A2140',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: '#33294A',
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
    paddingHorizontal: 2,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: '#8F83A8',
    paddingHorizontal: 2,
    marginTop: 3,
    marginBottom: Spacing.three,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    paddingHorizontal: 2,
    paddingBottom: Spacing.two,
  },
  loading: {
    paddingVertical: Spacing.four,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
    paddingHorizontal: 2,
    paddingBottom: Spacing.four,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: Spacing.two,
  },
  tile: {
    width: '48%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#241C38',
    backgroundColor: '#1C1430',
    overflow: 'hidden',
  },
  tileOn: {
    borderColor: Colors.amber,
  },
  swatch: {
    height: 64,
    backgroundColor: '#120C1A',
  },
  swatchBusy: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,4,10,0.45)',
  },
  tileFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  tileName: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: '#C8BCDD',
  },
  tileNameOn: {
    color: Colors.ember,
  },
});
