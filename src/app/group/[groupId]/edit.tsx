import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CampfireBannerArt } from '@/components/campfire-banner-art';
import { CampfireBannerPicker } from '@/components/campfire-banner-picker';
import { CampfireEmojiPicker } from '@/components/campfire/campfire-emoji-picker';
import { PrivacySelector } from '@/components/privacy-selector';
import { EmberFill } from '@/components/ui/ember-fill';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { DisciplineIcon, type DisciplineIconName } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGroup } from '@/hooks/use-group';
import { setCampfireBanner, updateCampfireHouseRules, updateCampfirePrivacy, updateGroup } from '@/lib/api/groups';
import { DEFAULT_LOADOUT, getItem } from '@/lib/economy/catalog';
import { getErrorMessage } from '@/lib/errors';
import { GOAL_TYPE_GLYPH } from '@/lib/goal-types';
import { RANK_TIER_LABEL, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { CampfirePrivacy, GoalType, RankTierName } from '@/types/database';

// Same lightweight theme set as group/create.tsx — kept in sync there rather than shared,
// since duplicating a 4-line array is cheaper than a shared-module indirection for two files.
const THEME_OPTIONS: { value: GoalType; icon: DisciplineIconName }[] = [
  { value: 'custom', icon: 'flame' },
  { value: 'study', icon: GOAL_TYPE_GLYPH.study },
  { value: 'gym', icon: GOAL_TYPE_GLYPH.gym },
  { value: 'run', icon: GOAL_TYPE_GLYPH.run },
];

// §1 · THE EMOJI AND THE BANNER ARE OWNER-EDITABLE. THIS REVERSES R1.
//
// Round 2's R1 made the emoji immutable after creation and this screen enforced it: the theme
// tiles were deleted and handleSave echoed `group.emoji` straight back. R2 did the same for the
// banner — the choice moved into the create flow and "Set banner" came out of the options sheet.
//
// Both are reversed here, on Noah's call, and the on-device run is why. Immutability assumed the
// value was set well at creation. It is not: creation DERIVES the emoji from the goal type, so
// every campfire is born wearing a generic flame, and the banner defaults to null. A campfire
// called Goat showed up as "🔥 Goat" with no way to fix it — which is exactly the "header copy
// is generic" report. An identity you cannot set is not an identity, it is a placeholder.
//
// So both fields live here now, and both SAVE WITH THE FORM rather than on tap — see the banner
// picker's deferred mode for why that distinction matters.

// The join gate's choices (design-mocks/94). Deliberately NOT the full ten-tier ladder — a gate is a
// filter on strangers, and past Diamond there is nobody left to filter. Null is the first option
// because "anyone" is the honest default for a campfire that hasn't decided.
const GATE_OPTIONS: (RankTierName | null)[] = [null, 'bronze', 'silver', 'gold', 'platinum', 'diamond'];

// design-mocks/10's create form, pre-filled — same stage/field/icon-tile styling. Privacy
// (PHILOI_UI_SPEC.md §14: "editable by the owner in campfire settings / Edit campfire at any
// point") is the one setting from create that's also editable here; class/course fields
// aren't (course-tagging a campfire after the fact isn't part of this pass).
export default function EditGroupScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { group, refetch } = useGroup(groupId);
  const [name, setName] = useState('');
  // Display only now (the name field's glyph). Nothing on this screen writes it.
  const [goalType, setGoalType] = useState<GoalType>('custom');
  const [privacy, setPrivacy] = useState<CampfirePrivacy>('open');
  const [minJoinTier, setMinJoinTier] = useState<RankTierName | null>(null);
  const [houseRule, setHouseRule] = useState('');
  const [emoji, setEmoji] = useState('🔥');
  const [bannerId, setBannerId] = useState<string | null>(null);
  const [bannerPickerOpen, setBannerPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setGoalType(group.goal_type);
    setPrivacy(group.privacy);
    setMinJoinTier(group.min_join_tier);
    setHouseRule(group.house_rule ?? '');
    setEmoji(group.emoji || '🔥');
    setBannerId(group.banner_item_id);
  }, [group]);

  async function handleSave() {
    if (!name.trim()) {
      setError('Give your campfire a name.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // §1: the emoji is the picker's value now, not an echo of what was already there.
      // update_campfire_details(p_name, p_emoji) already took both arguments, so this needs no
      // migration — the second one was simply never being used for anything.
      await updateGroup(groupId, { name: name.trim(), emoji });
      if (group && privacy !== group.privacy) {
        await updateCampfirePrivacy(groupId, privacy);
      }
      // Owner-only server-side (set_campfire_banner checks ownership), and written only when it
      // actually moved — an unconditional call would fail for an ADMIN who is not the owner while
      // they were legitimately editing the name.
      if (group && bannerId !== group.banner_item_id) {
        await setCampfireBanner(groupId, bannerId);
      }
      // Owner-only RPC — a member editing here would already have been stopped by the update above,
      // but the house rules carry their own check server-side either way.
      if (group && (minJoinTier !== group.min_join_tier || houseRule.trim() !== (group.house_rule ?? ''))) {
        await updateCampfireHouseRules(groupId, { minJoinTier, houseRule: houseRule.trim() || null });
      }
      await refetch();
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not update your campfire.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen padded={false} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={styles.title}>Edit campfire</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={Colors.muted} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.lbl}>Name</Text>
          <View style={styles.field}>
            <View style={styles.fieldIcon}>
              <DisciplineIcon name={THEME_OPTIONS.find((t) => t.value === goalType)?.icon ?? 'flame'} size={15} color={Colors.amber} />
            </View>
            <TextInput style={styles.fieldInput} placeholder="e.g. Morning Lifters" value={name} onChangeText={setName} maxLength={40} />
          </View>

          <Text style={styles.lbl}>Emoji</Text>
          <CampfireEmojiPicker value={emoji} onChange={setEmoji} />

          {/* The banner opens the SAME picker the options sheet used to, in deferred mode so it
              reports a choice instead of writing one. The swatch is a live preview of what is
              selected — the real scene at tile size, not a colour chip, since the banners differ
              by scene rather than by hue. */}
          <Text style={styles.lbl}>Banner</Text>
          <Pressable
            style={styles.bannerRow}
            onPress={() => setBannerPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose this campfire's banner">
            <View style={styles.bannerSwatch}>
              <CampfireBannerArt itemKey={bannerId} fadeTo="#161022" />
            </View>
            <Text style={styles.bannerLabel}>{bannerName(bannerId)}</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </Pressable>

          <Text style={styles.lbl}>Who can join</Text>
          <PrivacySelector value={privacy} onChange={setPrivacy} />

          {/* The join gate (mock 94's chip). Applies to people finding you through discovery — an
              invite code still gets someone in, because that is a member vouching in person. */}
          <Text style={styles.lbl}>Minimum rank to join</Text>
          <View style={styles.gateRow}>
            {GATE_OPTIONS.map((tier) => {
              const on = minJoinTier === tier;
              const metal = tier ? RANK_TIER_METAL[tier] : null;
              return (
                <Pressable
                  key={tier ?? 'any'}
                  onPress={() => setMinJoinTier(tier)}
                  style={[styles.gatePill, on && styles.gatePillOn, on && metal ? { borderColor: metal.outer } : null]}>
                  <Text style={[styles.gateLabel, on ? { color: metal?.text ?? Colors.achieverText } : null]}>
                    {tier ? `${RANK_TIER_LABEL[tier]}+` : 'Anyone'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.lbl}>House rule</Text>
          <View style={styles.field}>
            <View style={styles.fieldIcon}>
              <Ionicons name="flame" size={15} color={Colors.amber} />
            </View>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. 2h/day minimum, six days a week"
              value={houseRule}
              onChangeText={setHouseRule}
              maxLength={160}
              multiline
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <Pressable onPress={handleSave} disabled={loading} accessibilityRole="button">
          <EmberFill style={[styles.saveBtn, loading && styles.saveBtnBusy]} radius={Radius.button} direction="diagonal">
            <Ionicons name="checkmark" size={17} color={Colors.onEmber} />
            <Text style={styles.saveLabel}>{loading ? 'Saving…' : 'Save changes'}</Text>
          </EmberFill>
        </Pressable>
      </KeyboardAvoidingView>

      <CampfireBannerPicker
        visible={bannerPickerOpen}
        onClose={() => setBannerPickerOpen(false)}
        campfireName={name || group?.name || 'Your campfire'}
        groupId={groupId}
        currentBannerId={bannerId}
        onChanged={refetch}
        // Deferred — Save changes commits it, not the tap.
        onSelect={setBannerId}
      />
    </Screen>
  );
}

/** The banner's display name, or the base hearth's when nothing has been chosen. */
function bannerName(itemKey: string | null): string {
  return getItem(itemKey ?? DEFAULT_LOADOUT.banner ?? '')?.name ?? 'Hearthlight';
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 15,
    paddingTop: 16,
    // Save changes sat on the safe-area line. SafeAreaView clears the home indicator; this is the
    // breathing room above it (CAMPFIRE_REDESIGN_SPEC: "CTAs above the bottom safe area").
    paddingBottom: Spacing.three,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  form: {
    paddingBottom: 16,
  },
  lbl: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 12,
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  fieldIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontSize: 13,
    color: Colors.ink,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    padding: 10,
  },
  bannerSwatch: {
    width: 76,
    height: 42,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: '#120C1A',
  },
  bannerLabel: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  gateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  gatePill: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  gatePillOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.coral,
  },
  gateLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    marginTop: 8,
  },
  // §3 · EMBER GRADIENT, NOT FLAT AMBER.
  //
  // This carried a comment claiming it was "the ember treatment" while painting
  // `backgroundColor: Colors.amber` — one flat yellow. DESIGN_LANGUAGE_EMBER §3's primary is the
  // amber→coral GRADIENT (what PrimaryButton and the FAB paint); a solid amber slab is the
  // washed-out thing the rule exists to abolish, and it has now been reported three times. The
  // fill is <EmberFill> now, so there is no colour here to drift back.
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
  },
  saveBtnBusy: {
    opacity: 0.6,
  },
  saveLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.onEmber,
  },
});
