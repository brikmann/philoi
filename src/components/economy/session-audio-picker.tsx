import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { SESSION_AUDIO_NONE } from '@/lib/economy/equipped-audio';
import { useEquipped } from '@/lib/economy/loadout';
import { hasAmbientLoop } from '@/lib/sound';

// "This session's audio" — the per-session ambient switcher on the lock-in start sheet
// (COSMETIC_UI_FIXES §6.2, mock 164 panel 2).
//
// The equipped Audio item has always been the only thing a session could sound like, and changing
// it meant a trip to the inventory screen. That is the wrong shape for this preference: which
// environment you want is a property of the SESSION, not of your account. A 6am revision block and
// a Friday deadlift do not want the same loop, and neither of them wants you navigating a cosmetics
// grid to say so.
//
// "None — my own music" sits FIRST and is always present, even for someone who owns a single
// environment. It is the option people actually reach for at the gym, and burying it under the
// items would make the sheet read as "pick one of these" rather than "or don't".
//
// Collapsed by default. The start sheet is already the longest surface in the app on the gym
// branch (routines + energy + campfire), and the common case is starting a lock-in without
// thinking about audio at all — so this costs one row until someone wants it.

type Props = {
  /** `undefined` = follow the equipped item, SESSION_AUDIO_NONE = silence, else a catalog id. */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

export function SessionAudioPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const { owned } = useInventory();
  const equipped = useEquipped('audio');

  // Owned environments this build can actually play. An item granted by a newer server than the
  // installed app is filtered out rather than offered — picking it would produce silence with no
  // explanation, which is the exact failure `hasAmbientLoop` exists to prevent everywhere else.
  const environments = useMemo(() => {
    const seen = new Set<string>();
    return owned
      .filter((item) => item.type === 'AUDIO' && hasAmbientLoop(item.id))
      .filter((item) => (seen.has(item.id) ? false : seen.add(item.id)))
      .sort((a, b) => (a.id === equipped?.id ? -1 : b.id === equipped?.id ? 1 : a.name.localeCompare(b.name)));
  }, [owned, equipped]);

  // Nothing playable and nothing equipped means there is no choice to offer — not even "none",
  // which would be a switch with one position.
  if (environments.length === 0) return null;

  const selectedId = value ?? equipped?.id;
  const summary =
    value === SESSION_AUDIO_NONE
      ? 'None — my own music'
      : (environments.find((e) => e.id === selectedId)?.name ?? equipped?.name ?? 'None');

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.summaryRow}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`This session's audio: ${summary}`}>
        <Ionicons
          name={value === SESSION_AUDIO_NONE ? 'volume-mute' : 'musical-notes'}
          size={14}
          color={Colors.textTertiary}
        />
        <View style={styles.summaryText}>
          <Text style={styles.summaryLabel}>This session&apos;s audio</Text>
          <Text style={styles.summaryValue} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textTertiary} />
      </Pressable>

      {open && (
        <View style={styles.options}>
          <Option
            icon="volume-mute"
            title="None — my own music"
            sub="Philoi stays silent"
            selected={value === SESSION_AUDIO_NONE}
            onPress={() => onChange(SESSION_AUDIO_NONE)}
          />
          {environments.map((item) => (
            <Option
              key={item.id}
              icon="musical-notes"
              title={item.name}
              sub={item.id === equipped?.id ? 'Equipped' : 'Owned'}
              selected={value !== SESSION_AUDIO_NONE && selectedId === item.id}
              // Choosing the equipped one clears the override rather than pinning it, so a session
              // started without touching this behaves identically to one started before it existed.
              onPress={() => onChange(item.id === equipped?.id ? undefined : item.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function Option({
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
      style={[styles.option, selected && styles.optionSelected]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}>
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={14} color={selected ? Colors.coral : Colors.textTertiary} />
      </View>
      <View style={styles.optionText}>
        <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.optionSub}>{sub}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot} />}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 11,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.cream,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  summaryText: {
    flex: 1,
  },
  summaryLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  summaryValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  options: {
    gap: 6,
    marginTop: 6,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: Colors.cream,
  },
  optionSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  optionIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  optionTitleSelected: {
    color: Colors.ink,
  },
  optionSub: {
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
    borderColor: Colors.coral,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.coral,
  },
});
