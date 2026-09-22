import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import {
  SESSION_AUDIO_NONE,
  applySessionAudioChoice,
  getSessionAudioChoice,
} from '@/lib/economy/equipped-audio';
import { useEquipped } from '@/lib/economy/loadout';
import { getRewardPreferencesSync, isSessionAudioEnabled } from '@/lib/reward-settings';
import { hasAmbientLoop } from '@/lib/sound';

// Swap what a LIVE session is playing, without ending it
// (CODE_PROMPT_lockin_audio_midsession_switch.md §C, mock 206b).
//
// The start sheet's SessionAudioPicker already asks this question — once, before the session, from
// a screen you have left by the time you want to change your mind. That is the gap: the environment
// you chose at your desk is not the one you want when you get up and walk to the gym, and the only
// routes to a different one were ending the session or a trip to the inventory grid. Neither is
// something anybody does forty minutes into a focus block.
//
// So this is the same choice, reachable from the one screen a locked-in user is actually on. It is
// deliberately NOT a second copy of the picker: that one WRITES a choice for a session that has not
// started, this one APPLIES one to a session that is already running, which is a different call
// (`applySessionAudioChoice`) and a different failure mode — a pick that updates state and produces
// no sound would read as a broken control.
//
// Stays open after a pick, on purpose. Choosing an ambient mix is something you do by ear, and a
// sheet that dismissed itself on the first tap would make comparing two of them a four-tap job.
//
// Spotify — "your own music" as a SOURCE rather than as silence — is §D of that directive and is
// not built here: it needs an OAuth surface, encrypted server-side token storage and an Edge
// Function to proxy the API read. "None — my own music" is the honest version of it meanwhile, and
// it is the one that already works with whatever the user is playing.

export function SessionAudioSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  // Inside a <Modal>, which renders outside the screen's SafeAreaView, so the inset is ours.
  const insets = useSafeAreaInsets();
  const { owned } = useInventory();
  const equipped = useEquipped('audio');

  // Seeded from module state rather than held by the lock-in screen: the choice outlives this
  // component — it belongs to the SESSION, not the sheet, and a mid-session equip can move it from
  // somewhere else entirely (see LoadoutSync).
  //
  // A mount-time seed is enough precisely because the lock-in screen mounts this only while it is
  // open, so every open is a fresh mount reading the current value. An effect that re-seeded on
  // `visible` would be a cascading render for a case that cannot arise — and if the mounting ever
  // changes to keep this alive across opens, the seed has to move to a key or a re-open callback,
  // not back into an effect.
  const [choice, setChoice] = useState<string | undefined>(getSessionAudioChoice);

  // Owned environments this build can actually play — the same filter the start sheet's picker
  // uses, and for the same reason: offering an item granted by a newer server than the installed
  // app would produce silence with no explanation.
  const environments = useMemo(() => {
    const seen = new Set<string>();
    return owned
      .filter((item) => item.type === 'AUDIO' && hasAmbientLoop(item.id))
      .filter((item) => (seen.has(item.id) ? false : seen.add(item.id)))
      .sort((a, b) => (a.id === equipped?.id ? -1 : b.id === equipped?.id ? 1 : a.name.localeCompare(b.name)));
  }, [owned, equipped]);

  const selectedId = choice ?? equipped?.id;
  const silent = choice === SESSION_AUDIO_NONE;

  // Both gates that can make a pick inaudible, read at open time. Saying so is the whole reason to
  // check: someone who turned session audio off in Settings months ago and now taps three
  // environments in a row deserves to be told why the session stayed quiet, rather than concluding
  // the feature is broken.
  const mutedBySettings = !getRewardPreferencesSync().reward_sfx_enabled || !isSessionAudioEnabled();

  function pick(next: string | undefined) {
    setChoice(next);
    applySessionAudioChoice(next);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grab} />

          <View style={styles.head}>
            <Ionicons name={silent ? 'volume-mute' : 'musical-notes'} size={16} color={Colors.ember} />
            <View style={styles.headText}>
              <Text style={styles.headTitle}>Session audio</Text>
              <Text style={styles.headSub} numberOfLines={1}>
                {mutedBySettings
                  ? 'Muted in Settings — your pick is kept, nothing plays'
                  : silent
                    ? 'Silent — your own music has the floor'
                    : `Playing · ${environments.find((e) => e.id === selectedId)?.name ?? equipped?.name ?? 'Nothing'}`}
              </Text>
            </View>
          </View>

          {/* Capped so a big collection can't push the way out off a short screen — the point of
              this sheet is that the session stays one tap from visible. */}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {/* First, always, and not sorted in among the items: at the gym this is the row people
                reach for, and burying it under the cosmetics would make the sheet read as "pick one
                of these" rather than "or don't". */}
            <AudioRow
              icon="volume-mute"
              title="None — my own music"
              sub="Philoi goes quiet for the rest of this session"
              selected={silent}
              onPress={() => pick(SESSION_AUDIO_NONE)}
            />
            {environments.map((item) => (
              <AudioRow
                key={item.id}
                icon="musical-notes"
                title={item.name}
                sub={item.id === equipped?.id ? 'Equipped' : 'Owned'}
                selected={!silent && selectedId === item.id}
                // Picking the equipped one clears the override rather than pinning it, so the
                // session lands in the state it would have been in had nobody touched this.
                onPress={() => pick(item.id === equipped?.id ? undefined : item.id)}
              />
            ))}
            {environments.length === 0 && (
              <Text style={styles.none}>
                No audio cosmetics yet — they&apos;re the cheapest thing in the shop, and the Forge takes them as fuel.
              </Text>
            )}
          </ScrollView>

          <Pressable style={styles.done} onPress={onClose} accessibilityRole="button">
            <Text style={styles.doneText}>Back to the session</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function AudioRow({
  icon,
  title,
  sub,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, selected && styles.rowOn]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={15} color={selected ? Colors.ember : Colors.textTertiary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, selected && styles.rowTitleOn]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot} />}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    // Dimmed, not opaque: the flame and the timer stay readable above the sheet, so swapping the
    // music never feels like leaving the session.
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.four,
  },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.lineStrong,
    marginBottom: Spacing.three,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  headText: {
    flex: 1,
  },
  headTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  headSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
  list: {
    maxHeight: 300,
  },
  listContent: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: Colors.cardDark,
  },
  rowOn: {
    borderColor: Colors.ember,
    backgroundColor: Colors.selectedBg,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  rowTitleOn: {
    color: Colors.ink,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: Colors.ember,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.ember,
  },
  none: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textTertiary,
    paddingVertical: Spacing.two,
  },
  done: {
    alignItems: 'center',
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  doneText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
});
