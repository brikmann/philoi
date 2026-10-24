import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PatronCrest } from '@/components/story-sticker/patron-crest';
import { EmberSearchBar } from '@/components/ui/ember-search-bar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { ProgramRow } from '@/types/house';

// ── THE PROGRAM PICKER (mock 291) ──
//
// Two states in one component: SEARCH (type a few letters, see your school's programs, each showing
// the house it grants) and CONFIRM (the medallion, "You will rep, as an Heir to {Patron}", the
// program and school). Shared by onboarding's Program step and /house/change-program, so the two
// can never word the choice differently.
//
// 🔴 THE PATRON IS NEVER PICKED. Every row is a PROGRAM; the house rides along as its consequence
// (programs.patron_key). The confirm's way out is "Choose a different program" — never "patron" —
// because changing the program is the only way the patron changes.
//
// It owns no network. The host fetches the list (it needs to know whether there is one at all, to
// skip the step) and saves the pick, so a failure is handled where the flow can route around it.

type Props = {
  /** Canonical school name — shown on the chip and in the confirm's "{Program} · {University}". */
  university: string;
  programs: ProgramRow[];
  /** Opens straight on CONFIRM for this program — a re-entry shows what was saved, not a blank search. */
  initialProgramId?: string | null;
  /** Marks the saved program with a ✓ but opens on SEARCH — the change screen, where the point is a new pick. */
  currentProgramId?: string | null;
  onConfirm: (program: ProgramRow) => void;
  saving?: boolean;
  /** Mock 291's "Looks right — continue". */
  confirmLabel?: string;
  /** The line under the house. Onboarding's says the ceremony comes after the tour. */
  confirmNote?: string | null;
  title?: string;
  subtitle?: string;
};

const DEFAULT_SUBTITLE =
  'Your program names who you rep — the Greek patron whose honour & legacy you carry, an Heir beside those who came before you.';

export function ProgramPicker({
  university,
  programs,
  initialProgramId,
  currentProgramId,
  onConfirm,
  saving,
  confirmLabel = 'Looks right — continue',
  confirmNote = null,
  title = 'What do you study?',
  subtitle = DEFAULT_SUBTITLE,
}: Props) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ProgramRow | null>(
    () => programs.find((p) => p.program_id === initialProgramId) ?? null
  );
  // Kept after "Choose a different program" so the list shows a ✓ on what they backed out of.
  const [lastPickedId, setLastPickedId] = useState<string | null>(initialProgramId ?? currentProgramId ?? null);

  // Name, short label and house all match — "kin", "Kin" and "heracles" should all find Kinesiology.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return programs;
    return programs.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.program_abbrev?.toLowerCase().includes(q) ?? false) ||
        p.patron_name.toLowerCase().includes(q)
    );
  }, [programs, query]);

  if (picked) {
    return (
      <View style={styles.fill}>
        <View style={styles.bighouse}>
          <HouseMedallion patronKey={picked.patron_key} patronName={picked.patron_name} />
          <Text style={styles.join}>You will rep, as an Heir to</Text>
          <Text style={styles.hname}>{picked.patron_name}</Text>
          {picked.patron_title ? <Text style={styles.htitle}>{picked.patron_title}</Text> : null}
          <Text style={styles.hprog}>
            {picked.name} · {university}
          </Text>
          <Text style={styles.legacy}>You carry this house&apos;s honour &amp; legacy — beside every Heir who came before you.</Text>
        </View>

        {confirmNote ? <Text style={styles.note}>{confirmNote}</Text> : null}

        <View style={styles.spacer} />
        <View style={styles.ctas}>
          <PrimaryButton label={confirmLabel} loading={saving} onPress={() => onConfirm(picked)} />
          <SecondaryButton
            label="Choose a different program"
            disabled={saving}
            onPress={() => {
              setLastPickedId(picked.program_id);
              setPicked(null);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Text style={styles.h}>{title}</Text>
      <Text style={styles.sub}>{subtitle}</Text>
      <View style={styles.unichip}>
        <Ionicons name="school-outline" size={12} color={Colors.muted} />
        <Text style={styles.unichipText} numberOfLines={1}>
          {university}
        </Text>
      </View>

      <EmberSearchBar value={query} onChangeText={setQuery} placeholder="Search your program" style={styles.search} />

      <FlatList
        data={matches}
        keyExtractor={(item) => item.program_id}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ProgramResultRow program={item} on={item.program_id === lastPickedId} onPress={() => setPicked(item)} />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No program at {university} matches &quot;{query.trim()}&quot;. Try its full name or a short form.
          </Text>
        }
      />
    </View>
  );
}

function ProgramResultRow({ program, on, onPress }: { program: ProgramRow; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${program.name}, Heir to ${program.patron_name}`}>
      <View style={styles.seal}>
        <PatronCrest patronKey={program.patron_key} name={program.patron_name} size={22} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.pn} numberOfLines={1}>
          {program.name}
        </Text>
        <Text style={styles.ph} numberOfLines={1}>
          Heir to <Text style={styles.phPatron}>{program.patron_name}</Text>
        </Text>
      </View>
      {on ? (
        <Ionicons name="checkmark" size={16} color={Colors.amber} />
      ) : program.program_abbrev ? (
        <View style={styles.ab}>
          <Text style={styles.abText}>{program.program_abbrev}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The crest medallion — mock 291's confirm and mock 286's claim screen draw the same disc: the
 * patron's hexagon crest on a dark well, a gold rim, a ring of background colour, a soft gold glow.
 */
export function HouseMedallion({
  patronKey,
  patronName,
  size = 90,
}: {
  patronKey: string;
  patronName: string;
  size?: number;
}) {
  return (
    <View style={[styles.medalRing, { width: size + 12, height: size + 12, borderRadius: (size + 12) / 2 }]}>
      <View style={[styles.medal, { width: size, height: size, borderRadius: size / 2 }]}>
        <PatronCrest patronKey={patronKey} name={patronName} size={Math.round(size * 0.56)} />
      </View>
    </View>
  );
}

const GOLD = Colors.ember;
const TITLE_GOLD = '#E9C879';

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
  },
  spacer: {
    flex: 1,
    minHeight: Spacing.twelve,
  },
  h: {
    fontFamily: Fonts.display,
    fontSize: 19,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: Colors.muted,
    marginTop: 5,
  },
  unichip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginTop: 10,
    maxWidth: '100%',
  },
  unichipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.muted,
  },
  search: {
    marginTop: Spacing.twelve,
  },
  list: {
    marginTop: Spacing.two,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 4,
  },
  rowOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: '#4A3418',
  },
  rowPressed: {
    opacity: 0.7,
  },
  seal: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1A1328',
    borderWidth: 1.5,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  pn: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  ph: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  phPatron: {
    fontFamily: Fonts.bodyBold,
    color: GOLD,
  },
  ab: {
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  abText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.muted,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
  },
  bighouse: {
    alignItems: 'center',
    marginTop: Spacing.four,
  },
  medalRing: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.forgeBg,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },
  medal: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1328',
    borderWidth: 2,
    borderColor: GOLD,
  },
  join: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
    marginTop: Spacing.three,
  },
  hname: {
    fontFamily: Fonts.black,
    fontSize: 26,
    color: Colors.ink,
    marginTop: 4,
    textAlign: 'center',
  },
  htitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: TITLE_GOLD,
    textTransform: 'uppercase',
    marginTop: 5,
    textAlign: 'center',
  },
  hprog: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.amber,
    marginTop: Spacing.twelve,
    textAlign: 'center',
  },
  legacy: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 11,
    lineHeight: 16.5,
    color: Colors.muted,
    textAlign: 'center',
    maxWidth: 240,
    marginTop: Spacing.twelve,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 18,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 22,
    paddingHorizontal: 6,
  },
  ctas: {
    gap: 10,
  },
});
