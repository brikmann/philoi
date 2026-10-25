import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OptionSheet } from '@/components/matchmaking/option-sheet';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { FIND_ME_LABELS, MATCH_SCOPE_LABELS } from '@/lib/api/matchmaking';
import type { FindMe, MatchScope, MatchSettings } from '@/types/social';

type MatchSettingsSectionProps = {
  settings: MatchSettings;
  busy: boolean;
  onChange: (patch: Partial<MatchSettings>) => void;
  /** The opt-in card already carries the discoverable switch while it's off — don't draw it twice. */
  hideDiscoverable?: boolean;
};

const SCOPE_OPTIONS: { value: MatchScope; label: string; sub: string }[] = [
  { value: 'program', label: MATCH_SCOPE_LABELS.program, sub: 'Only people in your program' },
  { value: 'uni', label: MATCH_SCOPE_LABELS.uni, sub: 'Anyone at your university' },
  { value: 'wider', label: MATCH_SCOPE_LABELS.wider, sub: 'Other schools too' },
];

const FIND_ME_OPTIONS: { value: FindMe; label: string; sub: string }[] = [
  { value: 'everyone', label: FIND_ME_LABELS.everyone, sub: 'Anyone whose search reaches you' },
  { value: 'friends_of_friends', label: FIND_ME_LABELS.friends_of_friends, sub: 'Only people who share a friend with you' },
  { value: 'same_uni', label: FIND_ME_LABELS.same_uni, sub: 'Only people at your university' },
];

// Mock 299 phone 3, "Finding people". The two scopes are different questions and the labels say
// so: Match within is who YOU look among, Who can find me is who may see YOU. 0275 shows a pair
// only when both people's settings admit each other.
export function MatchSettingsSection({ settings, busy, onChange, hideDiscoverable }: MatchSettingsSectionProps) {
  const [picker, setPicker] = useState<'scope' | 'find' | null>(null);

  return (
    <>
      <Text style={styles.heading}>Finding people</Text>
      <View style={styles.panel}>
        {!hideDiscoverable && (
          <View style={styles.row}>
            <Text style={styles.icon}>🧭</Text>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Show me in Grind-alikes</Text>
              <Text style={styles.rowSub}>Off = you match no one, see no one</Text>
            </View>
            <Toggle value={settings.discoverable} disabled={busy} onValueChange={(v) => onChange({ discoverable: v })} />
          </View>
        )}
        <Pressable style={styles.row} onPress={() => setPicker('scope')} disabled={busy} accessibilityRole="button">
          <Text style={styles.icon}>🎓</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Match within</Text>
            <Text style={styles.rowSub}>{MATCH_SCOPE_LABELS[settings.match_scope]}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
        </Pressable>
        <Pressable style={styles.row} onPress={() => setPicker('find')} disabled={busy} accessibilityRole="button">
          <Text style={styles.icon}>👥</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Who can find me</Text>
            <Text style={styles.rowSub}>{FIND_ME_LABELS[settings.find_me]}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
        </Pressable>
        <View style={[styles.row, styles.rowLast]}>
          <Text style={styles.icon}>📍</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Show my live status to matches</Text>
            <Text style={styles.rowSub}>Friends already see it — this is for everyone else</Text>
          </View>
          <Toggle value={settings.show_live} disabled={busy} onValueChange={(v) => onChange({ show_live: v })} />
        </View>
      </View>

      <OptionSheet
        visible={picker === 'scope'}
        title="Match within"
        options={SCOPE_OPTIONS}
        selected={settings.match_scope}
        onSelect={(v) => onChange({ match_scope: v })}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === 'find'}
        title="Who can find me"
        options={FIND_ME_OPTIONS}
        selected={settings.find_me}
        onSelect={(v) => onChange({ find_me: v })}
        onClose={() => setPicker(null)}
      />
    </>
  );
}

/** Off by default, and this card says so before anything else (mock 299 phone 3). */
export function MatchOptInCard({ busy, onEnable }: { busy: boolean; onEnable: (on: boolean) => void }) {
  return (
    <View style={styles.optIn}>
      <View style={styles.optInTop}>
        <View style={styles.rowBody}>
          <Text style={styles.optInTitle}>Show me in Grind-alikes</Text>
          <Text style={styles.rowSub}>It&apos;s off by default. Off = you match no one, see no one.</Text>
        </View>
        <Toggle value={false} disabled={busy} onValueChange={onEnable} />
      </View>
      <Text style={styles.seeLabel}>What matches can see</Text>
      <SeeRow icon="🎯" title="Goal & field" sub="From your public profile — nothing you've hidden" />
      <SeeRow icon="📊" title="Discipline mix" sub="What you lock in on" />
      <SeeRow icon="📍" title="Live status" sub="Only if you allow it below" last />
    </View>
  );
}

function SeeRow({ icon, title, sub, last }: { icon: string; title: string; sub: string; last?: boolean }) {
  return (
    <View style={[styles.seeRow, last && styles.rowLast]}>
      <Text style={styles.icon}>{icon}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.seeTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.amber,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  panel: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  icon: {
    width: 22,
    fontSize: 16,
    textAlign: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  optIn: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.28)',
    borderRadius: 16,
    padding: 14,
  },
  optInTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  optInTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  seeLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.muted,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  seeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  seeTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
});
