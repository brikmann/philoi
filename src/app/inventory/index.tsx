import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BoxArt, BOX_TINT } from '@/components/economy/box-art';
import { BoxStackSheet } from '@/components/economy/box-stack-sheet';
import { EmberPill, RarityLabel, SectionLabel, SourceTag } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { PreviewButton } from '@/components/economy/preview-button';
import { PhiloiIcon } from '@/components/ui/philoi-icon';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { useInventory, type BoxStack, type OwnedItem } from '@/hooks/use-inventory';
import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import { TYPE_FILTERS, itemsOfType, type ItemType } from '@/lib/economy/catalog';
import { badgeLabel } from '@/lib/economy/badges';
import { FORGE_LADDER, isForgeFuel } from '@/lib/economy/forge';
import { SORT_LABEL, SORT_MODES, loadSortMode, saveSortMode, sortOwned, type SortMode } from '@/lib/economy/inventory-sort';
import { RARITY_COLOR, type Rarity } from '@/lib/economy/rarity';

// Inventory + Equip (mock 67, 21a/21i). Opens on a live LOADOUT preview — the equipped card, halo,
// flame and title composed the way other people actually see you — because that's what makes an
// equip decision legible. Then a chip filter over the owned grid, with the equipped item per slot
// ringed and ticked.

export default function InventoryScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { embers, owned, equippedBySlot, boxStacks, badges, loading, error } = useInventory();
  const [filter, setFilter] = useState<ItemType | 'ALL'>('ALL');
  const [sort, setSort] = useState<SortMode>('recent');
  const [openingStack, setOpeningStack] = useState<BoxStack | null>(null);

  // Loaded rather than seeded: 'recent' renders correctly on the first frame and the stored choice
  // swaps in a tick later, so the grid never blocks on a disk read.
  useEffect(() => {
    let cancelled = false;
    loadSortMode().then((mode) => {
      if (!cancelled) setSort(mode);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function chooseSort(mode: SortMode) {
    setSort(mode);
    // Fire-and-forget: saveSortMode swallows its own failures, and the choice already applies.
    void saveSortMode(mode);
  }

  const shown = useMemo(
    () => sortOwned(filter === 'ALL' ? owned : owned.filter((i) => i.type === filter), sort),
    [owned, filter, sort]
  );

  // "6 of 7 Flames owned" — the completion line under the grid. Only meaningful on a single type.
  const ownedOfType = filter === 'ALL' ? null : `${shown.length} of ${itemsOfType(filter).length} ${filter.toLowerCase()}s owned`;

  // What the Forge could take, and the best rung it could actually complete. Computed off `owned`
  // rather than `shown` on purpose: the Forge does not care which category chip is active, and a
  // shortcut that vanished when you filtered to Flames would read as a bug.
  const forgeReady = useMemo(() => {
    const counts = new Map<Rarity, number>();
    let total = 0;
    for (const item of owned) {
      if (!isForgeFuel(item)) continue;
      total += 1;
      counts.set(item.rarity, (counts.get(item.rarity) ?? 0) + 1);
    }
    // Highest completable rung wins — that is the one worth naming, and it is what /forge will open
    // on if the user taps through with no rarity of their own in mind.
    const best = [...FORGE_LADDER].reverse().find((s) => (counts.get(s.from) ?? 0) >= s.need)?.from;
    return { total, best };
  }, [owned]);

  const flame = equippedBySlot.flame;
  const halo = equippedBySlot.halo;
  const card = equippedBySlot.card;
  const title = equippedBySlot.title;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.ink} />
          </Pressable>
          <Text style={styles.title}>Inventory</Text>
          <EmberPill embers={embers} />
        </View>

        {/* ── Loadout preview — "how others see you" ── */}
        <View style={[styles.loadout, card ? { backgroundColor: card.art.from } : null]}>
          <View style={styles.loadoutRow}>
            <View style={styles.avatarWrap}>
              {halo ? <View style={[styles.halo, { borderColor: halo.art.from }]} /> : null}
              <View style={styles.avatar}>
                <Ionicons name="person" size={26} color="#6a6480" />
              </View>
            </View>
            <View style={styles.who}>
              <Text style={styles.handle}>@{profile?.handle ?? 'you'}</Text>
              {title ? (
                <Text style={[styles.loadoutTitle, { color: RARITY_COLOR[title.rarity] }]}>✦ {stripQuotes(title.name)}</Text>
              ) : (
                <Text style={styles.noTitle}>No title equipped</Text>
              )}
              <Text style={styles.rank}>{profile?.university ?? 'Philoi'}</Text>
            </View>
            {flame ? (
              <View style={styles.loadoutFlame}>
                <ItemArt item={flame} size={34} />
              </View>
            ) : null}
          </View>
        </View>
        <Text style={styles.loadoutLabel}>Your loadout · how others see you</Text>

        {/* ── Category chips ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {TYPE_FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <Pressable
                key={f.key}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => setFilter(f.key)}
                accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Sort ──
            Its own row under the chips rather than another chip in that scroller: filtering and
            ordering are different questions, and folding them into one horizontal strip would make
            "Rarity" look like a twelfth category. */}
        {owned.length > 1 ? (
          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>Sort</Text>
            <View style={styles.segment}>
              {SORT_MODES.map((mode) => {
                const on = sort === mode;
                return (
                  <Pressable
                    key={mode}
                    style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                    onPress={() => chooseSort(mode)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Sort by ${SORT_LABEL[mode].toLowerCase()}`}>
                    <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{SORT_LABEL[mode]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ── Owned grid ── */}
        {loading ? <Text style={styles.hint}>Loading…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && shown.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing here yet.</Text>
            <Text style={styles.emptyBody}>
              Win challenges, climb the Flame Pass, or open a box — everything you own lands here.
            </Text>
            <Pressable style={styles.emptyCta} onPress={() => router.push('/shop')}>
              <Text style={styles.emptyCtaText}>Open the Shop</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.grid}>
            {shown.map((item) => (
              <ItemTile key={item.id} item={item} onPress={() => router.push({ pathname: '/inventory/[itemId]', params: { itemId: item.id } })} />
            ))}
          </View>
        )}

        {ownedOfType && shown.length > 0 ? <Text style={styles.hint}>{ownedOfType} · tap any to equip</Text> : null}

        {/* ── The Forge (mock 156 frame 2) ──
            The second way in, and the one that matters: the drawer row is for people who already
            know what the Forge is, this is for people standing in front of the spares.

            A ROUTE, not a select-mode over this grid. Mock 156 draws the shortcut as a multi-select
            action bar here, and building that would mean two fuel pickers — this one and /forge's —
            that have to agree about which items are eligible, on a rule (drop-pool membership plus
            grant source) that is exactly the kind that drifts when it lives in two places. So the
            selection happens once, on the screen that owns it, and this is the door.

            Counted rather than always shown, because "3 rares ready" is the whole pitch and an
            empty Forge has nothing to say. */}
        {forgeReady.total > 0 ? (
          <Pressable
            style={styles.forgeRow}
            onPress={() => router.push(forgeReady.best ? { pathname: '/forge', params: { rarity: forgeReady.best } } : '/forge')}
            accessibilityRole="button"
            accessibilityLabel="Open the Forge">
            <View style={styles.forgeIcon}>
              <PhiloiIcon name="forge" size={20} color={Colors.ember} />
            </View>
            <View style={styles.forgeText}>
              <Text style={styles.forgeTitle}>The Forge</Text>
              <Text style={styles.forgeSub}>
                {forgeReady.best
                  ? `You have enough ${forgeReady.best}s to forge one of the next tier up.`
                  : `${forgeReady.total} item${forgeReady.total === 1 ? '' : 's'} you could melt down into something better.`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </Pressable>
        ) : null}

        {/* ── Unopened boxes ──
            Without this the earn path dead-ends: grant_reward and the Flame Pass both drop boxes
            into loot_boxes, but until now the only way to open one was to buy a fresh one in the
            shop, so anything you EARNED just sat there invisible. */}
        {boxStacks.length > 0 ? (
          <>
            <SectionLabel label={`Unopened boxes · ${boxStacks.reduce((n, s) => n + s.count, 0)}`} />
            <View style={styles.boxRow}>
              {boxStacks.map((stack) => {
                const box = BOXES[stack.boxKey as BoxKey];
                if (!box) return null;
                return (
                  <Pressable
                    key={stack.boxKey}
                    style={styles.boxTile}
                    onPress={() => setOpeningStack(stack)}
                    accessibilityRole="button"
                    accessibilityLabel={`${box.name}, ${stack.count} unopened`}>
                    <View style={[styles.boxArt, { backgroundColor: BOX_TINT[box.key] }]}>
                      <BoxArt boxKey={box.key} size={38} />
                      {/* One tile per TYPE now (punchlist 9 §4) — eleven Vessels were eleven
                          identical tiles, so the count carries what the repetition used to. */}
                      {stack.count > 1 ? (
                        <View style={styles.countBadge}>
                          <Text style={styles.countBadgeText}>×{stack.count}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.boxName} numberOfLines={1}>
                      {box.name}
                    </Text>
                    {/* Provenance shows BEFORE opening (§1) so a box you won reads differently
                        from one you bought. Collapsed to one line here; the sheet itemises a
                        stack that mixes sources. */}
                    <Text style={styles.boxProv} numberOfLines={2}>
                      {stack.sources.length === 1 ? stack.sources[0].label : `${stack.sources.length} sources`}
                    </Text>
                    <View style={styles.openBtn}>
                      <Text style={styles.openBtnText}>Open</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* ── Badges ──
            Earned and paid are visually separated and never mixed (§0.3 / §6): an earned badge's
            provenance IS its value, and a bought one must never be styled to look earned. */}
        {badges.length > 0 ? (
          <>
            <SectionLabel label="Badges" />
            {(['earned', 'other'] as const).map((group) => {
              const rows = badges.filter((b) => (group === 'earned' ? b.source === 'earned' : b.source !== 'earned'));
              if (rows.length === 0) return null;
              return (
                <View key={group}>
                  <Text style={styles.badgeGroup}>{group === 'earned' ? 'Earned' : 'Bought & unlocked'}</Text>
                  {rows.map((b) => (
                    <Pressable
                      key={b.id}
                      style={styles.badgeRow}
                      onPress={() =>
                        Alert.alert(
                          badgeLabel(b.badge_key),
                          b.provenance ??
                            (b.source === 'earned' ? 'Earned. This one can never be bought.' : 'Unlocked cosmetic flair.')
                        )
                      }>
                      <View style={[styles.badgeDot, b.source === 'earned' && styles.badgeDotEarned]} />
                      <View style={styles.badgeText}>
                        <Text style={styles.badgeName}>{badgeLabel(b.badge_key)}</Text>
                        {b.provenance ? (
                          <Text style={styles.badgeProv} numberOfLines={1}>
                            {b.provenance}
                          </Text>
                        ) : null}
                      </View>
                      <SourceTag source={b.source} />
                    </Pressable>
                  ))}
                </View>
              );
            })}
            <Text style={styles.hint}>Earned badges can never be bought. Tap any badge for where it came from.</Text>
          </>
        ) : null}
      </ScrollView>

      <BoxStackSheet
        stack={openingStack}
        onClose={() => setOpeningStack(null)}
        onOpen={(count) => {
          if (!openingStack) return;
          // Slice off the front of the stack's own id list — these boxes already exist server-side,
          // so unlike the shop's buy-and-open there's nothing to purchase first.
          const ids = openingStack.ids.slice(0, count);
          setOpeningStack(null);
          router.push({ pathname: '/shop/open', params: { boxIds: ids.join(','), boxKey: openingStack.boxKey } });
        }}
      />
    </Screen>
  );
}

function ItemTile({ item, onPress }: { item: OwnedItem; onPress: () => void }) {
  // Which lock-in slots an SFX occupies (PUNCHLIST_13). ▶ start, ■ end, both lit when it's in both
  // — the tile's plain ✓ can only say "equipped somewhere", which for a two-slot item is the one
  // thing you don't need to know.
  const inStart = item.slots.includes('sfx_start');
  const inStop = item.slots.includes('sfx_stop');
  const showSfxSlots = item.type === 'SFX' && (inStart || inStop);

  return (
    <Pressable style={[styles.tile, item.equipped && styles.tileEquipped]} onPress={onPress}>
      {item.equipped && !showSfxSlots ? (
        <View style={styles.equipBadge}>
          <Text style={styles.equipBadgeText}>✓</Text>
        </View>
      ) : null}
      {showSfxSlots ? (
        <View style={styles.slotBadges}>
          {inStart ? (
            <View style={styles.slotBadge} accessibilityLabel="Equipped as start sting">
              <Ionicons name="play" size={7} color="#2a1608" />
            </View>
          ) : null}
          {inStop ? (
            <View style={styles.slotBadge} accessibilityLabel="Equipped as end sting">
              <Ionicons name="stop" size={7} color="#2a1608" />
            </View>
          ) : null}
        </View>
      ) : null}
      {/* Top-LEFT, opposite the equip/slot badges — the art here is only 40px wide, so a badge
          over it would cover the thing it's advertising. */}
      <View style={styles.previewBadge}>
        <PreviewButton item={item} variant="badge" />
      </View>
      <View style={styles.tileArt}>
        <ItemArt item={item} size={40} />
      </View>
      <Text style={styles.tileName} numberOfLines={1}>
        {item.name}
      </Text>
      <RarityLabel rarity={item.rarity} size={7} />
      {/* Earned vs bought has to be unambiguous everywhere it renders (§6). */}
      {item.source === 'earned' ? <SourceTag source="earned" /> : null}
    </Pressable>
  );
}

function stripQuotes(name: string): string {
  return name.replace(/^"|"$/g, '');
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
    flex: 1,
  },
  loadout: {
    height: 126,
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: Spacing.twelve,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: '#1a1010',
    justifyContent: 'center',
  },
  loadoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  avatarWrap: {
    width: 66,
    height: 66,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 3,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  who: {
    flex: 1,
  },
  handle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  loadoutTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    marginTop: 2,
  },
  noTitle: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  rank: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: '#d8cae8',
    marginTop: 6,
  },
  loadoutFlame: {
    alignSelf: 'flex-start',
    marginTop: Spacing.two,
  },
  loadoutLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    marginTop: Spacing.two,
  },
  chips: {
    gap: 7,
    paddingVertical: Spacing.twelve,
  },
  chip: {
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: Colors.cardDark,
  },
  chipOn: {
    backgroundColor: Colors.coral,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.muted,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  sortLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    flex: 1,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.pill,
    padding: 2,
  },
  segmentBtn: {
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 13,
  },
  segmentBtnOn: {
    backgroundColor: Colors.selectedBg,
  },
  segmentText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  segmentTextOn: {
    color: Colors.ink,
  },
  chipTextOn: {
    color: '#fff',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  tile: {
    width: '31.5%',
    backgroundColor: Colors.cream,
    borderRadius: 13,
    paddingTop: 9,
    paddingBottom: Spacing.two,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#2a2438',
    gap: 3,
  },
  // The equipped item per slot is ringed + ticked — the one piece of state the grid must carry.
  tileEquipped: {
    borderColor: Colors.amber,
  },
  equipBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  equipBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: '#2a1608',
  },
  // ▶ / ■ — which of the two lock-in stings this SFX is bound to. Sits where the plain ✓ would,
  // and replaces it: for a two-slot item "equipped" alone doesn't answer the question.
  slotBadges: {
    position: 'absolute',
    top: 5,
    right: 5,
    flexDirection: 'row',
    gap: 2,
    zIndex: 2,
  },
  slotBadge: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    zIndex: 2,
  },
  tileArt: {
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.ink,
    textAlign: 'center',
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.twelve,
  },
  // Mock 158's ember treatment, borrowed for the one row in the Inventory that leads somewhere new.
  forgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.amber,
    borderRadius: 13,
    padding: Spacing.twelve,
    marginTop: Spacing.three,
  },
  forgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.achieverBg,
  },
  forgeText: {
    flex: 1,
    gap: 2,
  },
  forgeTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ember,
  },
  forgeSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.muted,
  },
  boxRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  boxTile: {
    width: '31.5%',
    backgroundColor: Colors.cardDark,
    borderRadius: 13,
    paddingVertical: 9,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 3,
  },
  boxArt: {
    width: 46,
    height: 46,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadge: {
    position: 'absolute',
    top: -5,
    right: -8,
    minWidth: 20,
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    alignItems: 'center',
  },
  countBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: '#fff',
  },
  boxName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.ink,
    textAlign: 'center',
  },
  boxProv: {
    fontFamily: Fonts.body,
    fontSize: 7.5,
    lineHeight: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  openBtn: {
    marginTop: Spacing.one,
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  openBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: '#2a1608',
  },
  badgeGroup: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.muted,
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderRadius: 11,
    padding: Spacing.twelve,
    marginBottom: 6,
  },
  badgeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.trackAlt,
  },
  // Earned badges get the warm marker; bought ones stay neutral. Colour is never the ONLY
  // difference — the SourceTag on the right spells it out in words.
  badgeDotEarned: {
    backgroundColor: Colors.amber,
  },
  badgeText: {
    flex: 1,
  },
  badgeName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  badgeProv: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.five,
    gap: Spacing.two,
  },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
  },
  emptyBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  emptyCta: {
    marginTop: Spacing.two,
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  emptyCtaText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
});
