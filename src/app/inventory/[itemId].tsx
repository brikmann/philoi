import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmberIcon } from '@/components/economy/ember-icon';
import { RarityLabel, SourceTag, formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { PreviewButton } from '@/components/economy/preview-button';
import { SfxSlotPicker, type SfxChoice } from '@/components/economy/sfx-slot-picker';
import { PhiloiIcon } from '@/components/ui/philoi-icon';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAudioPreview, useStopPreviewOnLeave } from '@/hooks/use-audio-preview';
import { useInventory } from '@/hooks/use-inventory';
import { equipCosmetic, salvageCosmetic, unequipCosmetic } from '@/lib/api/inventory';
import { forgeStepFor, isForgeFuel } from '@/lib/economy/forge';
import { SFX_SLOTS, SLOT_LABEL, isDefaultItem, type SfxSlot } from '@/lib/economy/catalog';
import { getErrorMessage } from '@/lib/errors';
import { SALVAGE_EMBERS, SALVAGE_PCT, rarityGlow } from '@/lib/economy/rarity';

// Equip detail (mock 67B, 21i). One-tap Equip that NAMES the swap, plus Sell.
//
// Selling is the sharp edge here: it works on EARNED items too, and it is permanent — an earned
// title only comes back by earning it again. So the confirm escalates with what's at stake:
// anything Epic+ or earned gets a confirm, and the 1-of-1 "Ascended · Global" and dated season
// medals get an extra "this cannot be undone" step.

export default function ItemDetailScreen() {
  const router = useRouter();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { owned, equippedBySlot, refetch } = useInventory();
  const [busy, setBusy] = useState(false);
  // Navigating away has to kill the audition — a preview that follows you to the next screen reads
  // as a bug, and the player is a shared singleton so it genuinely would.
  useStopPreviewOnLeave(itemId);
  const { stop: stopPreviewNow } = useAudioPreview();

  const found = owned.find((o) => o.id === itemId);
  if (!found) {
    return (
      <Screen>
        <Text style={styles.missing}>You don&apos;t own that item.</Text>
      </Screen>
    );
  }
  // Narrowed once into a const so the async handlers below close over a non-nullable value —
  // TypeScript can't carry the early-return narrowing into a callback otherwise.
  const item = found;

  const current = item.slot ? equippedBySlot[item.slot] : undefined;
  const payout = SALVAGE_EMBERS[item.rarity];
  // SFX carries no catalog slot since PUNCHLIST_13 — it gets the Start/End/Both picker instead of
  // the single Equip button, and is emphatically not showcase-only despite `slot` being null.
  const isSfx = item.type === 'SFX';
  const sfxSlots = item.slots.filter((s): s is SfxSlot => s === 'sfx_start' || s === 'sfx_stop');

  async function doEquip() {
    setBusy(true);
    try {
      if (item.equipped && item.slot) await unequipCosmetic(item.slot);
      else await equipCosmetic(item);
      await refetch();
      router.back();
    } catch (e) {
      Alert.alert("Couldn't do that", getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Start / End / Both. Each option is a toggle against the current state, so tapping the lit one
   * clears those slots — that's what makes a separate Unequip button unnecessary here.
   *
   * Deliberately does NOT navigate back the way doEquip does: choosing a slot is a decision people
   * revise ("actually, both"), and bouncing to the grid after every tap would make the second
   * thought cost a round trip.
   */
  async function chooseSfxSlots(choice: SfxChoice) {
    const targets: SfxSlot[] = choice === 'both' ? [...SFX_SLOTS] : [choice];
    const alreadyExactly = targets.every((s) => sfxSlots.includes(s)) && sfxSlots.length === targets.length;
    setBusy(true);
    try {
      if (alreadyExactly) {
        for (const slot of targets) await unequipCosmetic(slot);
      } else {
        // Clear any slot this item holds that the new choice doesn't, so picking Start after Both
        // actually vacates End rather than leaving it behind.
        for (const slot of sfxSlots.filter((s) => !targets.includes(s))) await unequipCosmetic(slot);
        for (const slot of targets) await equipCosmetic(item, slot);
      }
      await refetch();
    } catch (e) {
      Alert.alert("Couldn't do that", getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  function confirmSell() {
    const permanent = item.oneOfOne || item.type === 'MEDAL' || item.seasonStamped;
    const needsConfirm = permanent || item.source === 'earned' || ['epic', 'legendary', 'mythic'].includes(item.rarity);

    const run = async () => {
      setBusy(true);
      // Selling deletes the item; leaving its preview playing over the confirmation would be the
      // one sound in the app with nothing left to point at.
      stopPreviewNow();
      try {
        const embers = await salvageCosmetic(item);
        await refetch();
        Alert.alert('Sold', `${item.name} became 🔥 ${formatEmbers(embers)}.`);
        router.back();
      } catch (e) {
        Alert.alert("Couldn't sell that", getErrorMessage(e, 'Something went wrong.'));
      } finally {
        setBusy(false);
      }
    };

    if (!needsConfirm) {
      run();
      return;
    }

    Alert.alert(
      `Sell ${item.name}?`,
      permanent
        ? `This is a one-of-a-kind, season-stamped item. Selling it is PERMANENT — it can never be re-issued, and no amount of embers buys it back. You'll get 🔥 ${formatEmbers(payout)}.`
        : item.source === 'earned'
          ? `You earned this. Selling it is permanent — the only way to get it back is to earn it again. You'll get 🔥 ${formatEmbers(payout)}.`
          : `Selling is permanent. You'll get 🔥 ${formatEmbers(payout)}.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: permanent ? 'Sell forever' : 'Sell', style: 'destructive', onPress: run },
      ]
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.glow, { backgroundColor: rarityGlow(item.rarity, 0.5) }]} />
          <Pressable style={styles.back} onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </Pressable>
          <ItemArt item={item} size={120} />
        </View>

        {/* An audio cosmetic's art is a placeholder for the thing you actually own — the sound.
            The audition sits directly under it, which is as close to "the item itself" as this
            screen can get (PUNCHLIST_11). Renders nothing for items with no clip. */}
        <View style={styles.previewRow}>
          <PreviewButton item={item} />
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>{item.name}</Text>
          <RarityLabel rarity={item.rarity} type={item.type} size={10} />
          <Text style={styles.lore}>{item.lore}</Text>

          <View style={styles.tags}>
            <SourceTag source={item.source} />
            {/* The real stamp from the grant ("🌍 GLOBAL #1 · S1") when there is one; the catalog's
                generic flag only as a fallback for season items granted without a scope. */}
            {item.seasonStamp ? (
              <View style={styles.stamp}>
                <Text style={styles.stampText}>{item.seasonStamp}</Text>
              </View>
            ) : item.seasonStamped ? (
              <View style={styles.stamp}>
                <Text style={styles.stampText}>SEASON-STAMPED</Text>
              </View>
            ) : null}
          </View>

          {item.provenance ? <Text style={styles.provenance}>{item.provenance}</Text> : null}

          {/* Relics + Medals are showcase-only — no equip, provenance instead (21i). */}
          {item.showcaseOnly ? (
            <View style={styles.swap}>
              <Text style={styles.swapText}>
                This is a showcase piece. It lives in your vault rather than a slot — there&apos;s nothing to equip.
              </Text>
            </View>
          ) : isSfx ? (
            <View style={styles.sfxPicker}>
              <SfxSlotPicker slots={sfxSlots} onChoose={chooseSfxSlots} disabled={busy} />
            </View>
          ) : (
            <View style={styles.swap}>
              <Text style={styles.swapText}>
                {item.equipped
                  ? `Equipped now. Unequipping leaves your ${SLOT_LABEL[item.slot!]} slot empty.`
                  : current
                    ? `Equipping this replaces your current ${SLOT_LABEL[item.slot!]}, `
                    : `Nothing is in your ${SLOT_LABEL[item.slot!]} slot yet.`}
                {!item.equipped && current ? <Text style={styles.swapBold}>{current.name}</Text> : null}
                {!item.equipped && current ? '. One active at a time.' : ''}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.ctas}>
          {/* SFX equips through the Start/End/Both picker above — a single Equip button here would
              have to silently pick a slot on the user's behalf. */}
          {!item.showcaseOnly && !isSfx ? (
            <Pressable style={styles.equipBtn} onPress={doEquip} disabled={busy}>
              <Text style={styles.equipBtnText}>
                {item.equipped ? `Unequip ${SLOT_LABEL[item.slot!]}` : `Equip ${SLOT_LABEL[item.slot!]}`}
              </Text>
            </Pressable>
          ) : null}

          {/* Starter items have no Sell at all (#88). They're the floor a slot falls back to, so
              salvaging one would leave a slot with nothing to return to — the server refuses it
              regardless, and a button that always errors is worse than no button. */}
          {isDefaultItem(item.id) ? (
            <Text style={styles.sellNote}>Part of your starter set · permanent, can&apos;t be sold</Text>
          ) : (
            <>
              {/* The Forge shortcut (mock 156 frame 2), sitting where it belongs: next to Sell, on
                  the screen you are already on when you have decided you don't want something.
                  That is the decision the Forge competes for — sell it for embers, or feed it in.
                  Offering the choice anywhere else would mean asking it before it has been made.

                  Only shown for items the Forge can actually take. isForgeFuel is the client's
                  mirror of forge_combine's gate, so a season item, a relic or starter gear never
                  gets a button that would fail — and the server refuses them anyway. Mythics get no
                  button either: there is no rung above them, so they are output only. */}
              {isForgeFuel(item) && forgeStepFor(item.rarity) ? (
                <Pressable
                  style={styles.forgeBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/forge',
                      // Carried through so the Forge opens on the right recipe with this item
                      // already in a slot — "send to Forge" should not mean "find it again".
                      params: { rarity: item.rarity, items: item.ownedId },
                    })
                  }
                  disabled={busy}>
                  <PhiloiIcon name="forge" size={16} color={Colors.ember} />
                  <Text style={styles.forgeBtnText}>
                    Send to the Forge · {forgeStepFor(item.rarity)!.need} {item.rarity}s make a{' '}
                    {forgeStepFor(item.rarity)!.into}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.sellBtn} onPress={confirmSell} disabled={busy}>
                <View style={styles.sellBtnRow}>
                  <Text style={styles.sellBtnText}>Sell ·</Text>
                  <EmberIcon size={14} />
                  <Text style={styles.sellBtnText}>
                    {formatEmbers(payout)}{' '}
                    <Text style={styles.sellSub}>
                      · {SALVAGE_PCT[item.rarity]}% salvage ({item.rarity})
                    </Text>
                  </Text>
                </View>
              </Pressable>
              <Text style={styles.sellNote}>Selling unequips it and is permanent · confirm required</Text>
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing.six,
  },
  missing: {
    fontFamily: Fonts.body,
    color: Colors.muted,
  },
  hero: {
    height: 210,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  back: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.twelve,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: Spacing.four,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.ink,
  },
  lore: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 12.5,
    lineHeight: 19,
    color: '#b7a9cc',
    marginTop: Spacing.twelve,
  },
  tags: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  stamp: {
    backgroundColor: Colors.selectedBg,
    borderRadius: Radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  stampText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.8,
    color: '#c79bec',
  },
  provenance: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: Spacing.two,
  },
  previewRow: {
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  sfxPicker: {
    marginTop: Spacing.three,
  },
  swap: {
    marginTop: Spacing.three,
    backgroundColor: Colors.cardDark,
    borderRadius: 11,
    padding: Spacing.twelve,
  },
  swapText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: Colors.muted,
  },
  swapBold: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  ctas: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    gap: Spacing.two,
  },
  equipBtn: {
    backgroundColor: Colors.amber,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  equipBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: '#2a1608',
  },
  // Ember-outlined rather than filled: Sell is the established action on this screen and the Forge
  // is the alternative to it, not a replacement — a solid ember slab here would outrank Equip.
  forgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.amber,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: Spacing.two,
  },
  forgeBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ember,
    textAlign: 'center',
  },
  sellBtn: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sellBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sellBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ember,
  },
  sellSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  sellNote: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
